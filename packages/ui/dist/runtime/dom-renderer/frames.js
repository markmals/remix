import { createComponentErrorEvent } from '../error-event.js';
import { createFrame, isFrameRuntime } from '../frame.js';
import { unwrapFrameResolution } from '../frame-resolution.js';
import { createRangeRoot } from '../vdom.js';
const FRAME_RUNTIME_REQUIRED = 'Cannot render <Frame /> without frame runtime. Use run() or pass frameInit to createRoot/createRangeRoot.';
/**
 * Mounts a `<Frame>` as a host-owned comment-bounded range.
 *
 * During hydration the server-rendered `rmx:f` markers are adopted and the
 * frame instance created by the frame runtime for those markers is reused, so
 * streamed content already in the document is never re-fetched or re-inserted.
 * Otherwise fresh markers are inserted, the fallback renders into a nested
 * range root, and the frame source is resolved asynchronously.
 *
 * @param props Frame props, including `src`, `name`, and `fallback`.
 * @param parent Parent the frame range is mounted into.
 * @param before Node the range is inserted before, or `null` to append.
 * @param frame Frame handle of the enclosing tree, which owns the frame runtime.
 * @param styles Style manager shared with the enclosing root.
 * @param cursor Hydration cursor, when the frame is mounting into server HTML.
 * @returns The renderer's handle on the mounted frame.
 */
export function createDomFrame(props, parent, before, frame, styles, cursor) {
    let runtime = getFrameRuntime(frame);
    if (!runtime || runtime.canResolveFrames === false) {
        throw new Error(FRAME_RUNTIME_REQUIRED);
    }
    let currentProps = props;
    let range = adoptFrameRange(currentProps, runtime, cursor) ??
        mountFrameRange(currentProps, parent, before, frame, runtime, styles);
    return {
        get start() {
            return range.start;
        },
        get end() {
            return range.end;
        },
        update(nextProps) {
            let previousProps = currentProps;
            currentProps = nextProps;
            let previousSrc = previousProps.src;
            let nextSrc = nextProps.src;
            let previousName = getFrameName(previousProps);
            let nextName = getFrameName(nextProps);
            // A renamed frame, or one whose source changes before the pending
            // resolution has landed, remounts so a stream started for the old
            // identity cannot take over the new one. The renderer keeps this wrapper
            // and anchors on the current start/end, so the replacement happens in
            // place and the boundaries simply move to the new range.
            if (previousName !== nextName || (previousSrc !== nextSrc && !range.resolved)) {
                let currentParent = range.start.parentNode ?? parent;
                let replaceBefore = range.end.nextSibling;
                disposeFrameRange(range);
                removeFrameRange(range, currentParent);
                range = mountFrameRange(currentProps, currentParent, replaceBefore, frame, runtime, styles);
                return;
            }
            let serverFrameReload = runtime.serverFrameReload;
            if (previousSrc !== nextSrc) {
                range.instance.handle.src = nextSrc;
                resolveClientFrame(range, currentProps, runtime, serverFrameReload);
            }
            else if (serverFrameReload) {
                // Client frames keeping the same src still reload when the render was
                // triggered by an ancestor frame reload.
                resolveClientFrame(range, currentProps, runtime, serverFrameReload);
            }
            if (!range.resolved && range.fallbackRoot) {
                range.fallbackRoot.render(currentProps.fallback ?? null);
            }
        },
        dispose() {
            // Resources only: the renderer removes the start..end range itself, and
            // removing it here would strand nodes the renderer still anchors on.
            disposeFrameRange(range);
        },
    };
}
/**
 * Reports whether a node is a server-rendered frame start marker.
 *
 * @param node Node to test.
 * @returns `true` for a `rmx:f:<id>` comment.
 */
export function isFrameStartComment(node) {
    return isCommentNode(node) && node.data.trim().startsWith('rmx:f:');
}
function adoptFrameRange(props, runtime, cursor) {
    if (!cursor || cursor.current === cursor.end)
        return undefined;
    let start = cursor.current;
    if (!isFrameStartComment(start))
        return undefined;
    let end = findFrameEndComment(start, cursor.end);
    if (!end)
        return undefined;
    // createSubFrames() already built the instance for these markers while the
    // document streamed in; adopting it keeps the streamed content live.
    let instance = runtime.frameInstances.get(start);
    if (!instance) {
        instance = createFrameInstance(props, [start, end], runtime);
        runtime.frameInstances.set(start, instance);
    }
    cursor.current = end.nextSibling;
    return {
        start,
        end,
        instance,
        fallbackRoot: undefined,
        resolveToken: 0,
        resolveController: undefined,
        resolved: true,
    };
}
function mountFrameRange(props, parent, before, frame, runtime, styles) {
    let doc = parent.ownerDocument ?? document;
    let start = doc.createComment(` rmx:f:f${crypto.randomUUID().slice(0, 8)} `);
    let end = doc.createComment(' /rmx:f ');
    parent.insertBefore(start, before);
    parent.insertBefore(end, before);
    // The fallback renders through its own range root so fallback content follows
    // the same component semantics as any other tree, and is torn down as a unit
    // once the frame resolves.
    let fallbackRoot = createRangeRoot([start, end], { frame, styleManager: styles });
    fallbackRoot.render(props.fallback ?? null);
    let instance = createFrameInstance(props, [start, end], runtime);
    runtime.frameInstances.set(start, instance);
    let range = {
        start,
        end,
        instance,
        fallbackRoot,
        resolveToken: 0,
        resolveController: undefined,
        resolved: false,
    };
    resolveClientFrame(range, props, runtime, runtime.serverFrameReload);
    return range;
}
function createFrameInstance(props, boundaries, runtime) {
    return createFrame(boundaries, {
        name: getFrameName(props),
        src: props.src,
        errorTarget: runtime.errorTarget,
        loadModule: runtime.loadModule,
        resolveFrame: runtime.resolveFrame,
        pendingClientEntries: runtime.pendingClientEntries,
        scheduler: runtime.scheduler,
        styleManager: runtime.styleManager,
        data: {},
        moduleCache: runtime.moduleCache,
        moduleLoads: runtime.moduleLoads,
        frameInstances: runtime.frameInstances,
        namedFrames: runtime.namedFrames,
    });
}
function resolveClientFrame(range, props, runtime, serverFrameReload) {
    let instance = range.instance;
    // Every resolution owns a token. A later resolution bumps it, so an earlier
    // one that is still in flight stops before touching the range.
    let token = range.resolveToken + 1;
    range.resolveToken = token;
    range.resolveController?.abort();
    let reload = serverFrameReload
        ? instance.beginClientFrameReloadForAncestorReload(serverFrameReload.signal)
        : undefined;
    if (!reload) {
        instance.cancelReload();
    }
    let resolveController = reload?.controller ?? new AbortController();
    range.resolveController = resolveController;
    let frameCommitted = Promise.withResolvers();
    let resolve = Promise.resolve()
        .then(() => runtime.resolveFrame(props.src, {
        signal: resolveController.signal,
        target: getFrameName(props),
    }))
        .then(async (resolution) => {
        if (range.resolveToken !== token || resolveController.signal.aborted)
            return;
        let { content } = await unwrapFrameResolution(resolution);
        if (range.resolveToken !== token || resolveController.signal.aborted)
            return;
        range.fallbackRoot?.dispose();
        range.fallbackRoot = undefined;
        let nextContent = asAbortableFrameContent(content, resolveController.signal);
        await instance.render(nextContent, {
            signal: resolveController.signal,
            reconciliationTracker: serverFrameReload?.reconciliationTracker,
            blockingFrameTracker: serverFrameReload?.blockingFrameTracker,
            onCommit: frameCommitted.resolve,
        });
        if (range.resolveToken !== token || resolveController.signal.aborted)
            return;
        range.resolved = true;
    })
        .catch((error) => {
        if (reload && range.resolveToken === token && !resolveController.signal.aborted) {
            runtime.errorTarget.dispatchEvent(createComponentErrorEvent(error));
        }
    })
        .finally(() => {
        frameCommitted.resolve();
        reload?.complete();
        if (range.resolveController === resolveController) {
            range.resolveController = undefined;
        }
    });
    // A frame with a fallback shows something immediately, so an ancestor reload
    // does not have to wait for it.
    if (serverFrameReload?.reconciliationTracker && !props.fallback) {
        serverFrameReload.reconciliationTracker.waitFor(resolve);
    }
    if (serverFrameReload?.blockingFrameTracker && !props.fallback) {
        serverFrameReload.blockingFrameTracker.waitFor(frameCommitted.promise);
    }
}
function disposeFrameRange(range) {
    range.resolveToken++;
    range.resolveController?.abort();
    range.resolveController = undefined;
    range.fallbackRoot?.dispose();
    range.fallbackRoot = undefined;
    range.instance.dispose();
}
function removeFrameRange(range, parent) {
    let cursor = range.start;
    while (cursor) {
        let nextSibling = cursor.nextSibling;
        if (cursor.parentNode === parent) {
            parent.removeChild(cursor);
        }
        if (cursor === range.end)
            break;
        cursor = nextSibling;
    }
}
function asAbortableFrameContent(content, signal) {
    if (!(content instanceof ReadableStream))
        return content;
    return createAbortableReadableStream(content, signal);
}
function createAbortableReadableStream(source, signal) {
    let reader = source.getReader();
    let aborted = false;
    let onAbort = () => {
        aborted = true;
        void reader.cancel(signal.reason);
    };
    if (signal.aborted)
        onAbort();
    else
        signal.addEventListener('abort', onAbort, { once: true });
    return new ReadableStream({
        async pull(controller) {
            if (aborted) {
                controller.close();
                return;
            }
            let removeAbortReadListener;
            let abortRead = new Promise((resolve) => {
                if (signal.aborted) {
                    resolve({ done: true, value: undefined });
                    return;
                }
                let onAbortRead = () => {
                    resolve({ done: true, value: undefined });
                };
                removeAbortReadListener = () => signal.removeEventListener('abort', onAbortRead);
                signal.addEventListener('abort', onAbortRead, { once: true });
            });
            let result = await Promise.race([reader.read(), abortRead]);
            removeAbortReadListener?.();
            if (result.done) {
                controller.close();
                return;
            }
            controller.enqueue(result.value);
        },
        cancel(reason) {
            signal.removeEventListener('abort', onAbort);
            return reader.cancel(reason);
        },
    });
}
function getFrameRuntime(frame) {
    let runtime = frame.$runtime;
    return isFrameRuntime(runtime) ? runtime : undefined;
}
function getFrameName(props) {
    let name = props.name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
}
function findFrameEndComment(start, before) {
    let depth = 1;
    let node = start.nextSibling;
    while (node && node !== before) {
        if (isFrameStartComment(node))
            depth++;
        else if (isFrameEndComment(node)) {
            depth--;
            if (depth === 0)
                return node;
        }
        node = node.nextSibling;
    }
    return null;
}
function isFrameEndComment(node) {
    return isCommentNode(node) && node.data.trim() === '/rmx:f';
}
function isCommentNode(node) {
    return node?.nodeType === Node.COMMENT_NODE;
}
//# sourceMappingURL=frames.js.map