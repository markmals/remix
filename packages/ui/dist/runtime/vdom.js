import { createFrameHandle } from './component.js';
import { defaultStyleManager, resetStyleState } from './diff-props.js';
import { createDomHost } from './dom-renderer/host.js';
import { createComponentErrorEvent, getComponentError, } from './error-event.js';
import { createFrameRuntime, isFrameRuntime } from './frame.js';
import { invariant } from './invariant.js';
import { componentStalenessCheck, registerRoot, unregisterRoot } from './refresh.js';
import { createScheduler } from './scheduler.js';
import { TypedEventTarget } from './typed-event-target.js';
import { createRenderer } from '../renderer.js';
export { createScheduler };
export { resetStyleState };
function getHydrationComponentIdFromRangeStart(start) {
    if (!(start instanceof Comment))
        return undefined;
    let marker = start.data.trim();
    if (!marker.startsWith('rmx:h:'))
        return undefined;
    let id = marker.slice('rmx:h:'.length);
    return id.length > 0 ? id : undefined;
}
/**
 * Creates a virtual root bounded by two DOM nodes.
 *
 * @param boundaries Start and end marker nodes that define the render region.
 * @param options Root configuration.
 * @returns A virtual root controller.
 */
export function createRangeRoot(boundaries, options = {}) {
    let [start, end] = boundaries;
    let container = end.parentNode;
    invariant(container, 'Expected parent node');
    invariant(start.parentNode === container, 'Boundaries must share parent');
    // An empty range has nothing to adopt. Otherwise the end marker bounds
    // hydration: content past it belongs to whatever owns the surrounding
    // region, not to this root.
    let hydrationStart = start.nextSibling;
    let hasServerContent = hydrationStart !== null && hydrationStart !== end;
    return createVirtualRoot({
        container,
        before: end,
        styles: options.styleManager ?? defaultStyleManager,
        hydration: hasServerContent ? { current: hydrationStart, end } : undefined,
        componentId: getHydrationComponentIdFromRangeStart(start),
        options,
    });
}
/**
 * Creates a virtual root for a host container element.
 *
 * @param container Host element to render into.
 * @param options Root configuration.
 * @returns A virtual root controller.
 */
export function createRoot(container, options = {}) {
    let styles = options.styleManager ?? defaultStyleManager;
    let hasServerContent = container.innerHTML.trim() !== '';
    if (hasServerContent) {
        // Adopt additively: multiple roots hydrating separate islands may share
        // the default style manager, and adopting a later island must not release
        // the server styles an earlier island still depends on.
        styles.adoptServerStyles(container);
    }
    return createVirtualRoot({
        container,
        before: null,
        styles,
        hydration: hasServerContent ? { current: container.firstChild } : undefined,
        componentId: undefined,
        options,
    });
}
function createVirtualRoot(target) {
    let { container, before, styles, options } = target;
    let currentElement;
    let hydration = target.hydration;
    let eventTarget = new TypedEventTarget();
    let scheduler = options.scheduler ?? createScheduler(container.ownerDocument ?? document, eventTarget);
    let frameHandle = options.frame ??
        createRootFrameHandle({
            src: options.frameInit?.src,
            resolveFrame: options.frameInit?.resolveFrame,
            loadModule: options.frameInit?.loadModule,
            errorTarget: eventTarget,
            scheduler,
            styleManager: styles,
        });
    let renderer = createRenderer(createDomHost(scheduler, styles));
    function createCoreRoot() {
        return renderer.createRoot(container, {
            scheduler,
            frame: frameHandle,
            before,
            hydration,
            componentId: target.componentId,
            getFrameByName(name) {
                let runtime = frameHandle.$runtime;
                return isFrameRuntime(runtime) ? runtime.namedFrames.get(name) : undefined;
            },
            getTopFrame() {
                let runtime = frameHandle.$runtime;
                return isFrameRuntime(runtime) ? runtime.topFrame : undefined;
            },
            shouldRemountComponent(type) {
                return componentStalenessCheck !== null && componentStalenessCheck(type) === true;
            },
        });
    }
    let core = createCoreRoot();
    let disposed = false;
    let isErrorForwardingAttached = false;
    function forwardDomError(event) {
        eventTarget.dispatchEvent(createComponentErrorEvent(getComponentError(event)));
    }
    function attachDomErrorForwarding() {
        if (isErrorForwardingAttached)
            return;
        container.addEventListener('error', forwardDomError);
        isErrorForwardingAttached = true;
    }
    function detachDomErrorForwarding() {
        if (!isErrorForwardingAttached)
            return;
        container.removeEventListener('error', forwardDomError);
        isErrorForwardingAttached = false;
    }
    attachDomErrorForwarding();
    let root = Object.assign(eventTarget, {
        render(element) {
            attachDomErrorForwarding();
            currentElement = element;
            if (disposed) {
                core = createCoreRoot();
                disposed = false;
            }
            // This render claims whatever the server left behind, so a root created
            // after it never re-adopts content the previous root removed. A root
            // disposed before it ever rendered leaves the server content untouched
            // and a later render still hydrates it.
            hydration = undefined;
            // Rendering through the scheduler keeps DOM roots on the DOM error
            // policy: a failed render is logged and reported as an error event
            // instead of thrown at whoever called render().
            let mounted = core;
            scheduler.enqueueWork([() => mounted.render(element)]);
            scheduler.flush();
        },
        reconcile() {
            if (currentElement === undefined)
                return;
            root.render(currentElement);
        },
        dispose() {
            detachDomErrorForwarding();
            unregisterRoot(root);
            currentElement = undefined;
            if (disposed)
                return;
            disposed = true;
            let mounted = core;
            scheduler.enqueueWork([() => mounted.unmount()]);
            scheduler.flush();
        },
        flush() {
            scheduler.flush();
        },
    });
    registerRoot(root);
    return root;
}
function createRootFrameHandle(init) {
    let resolveFrame = init.resolveFrame ??
        (() => {
            throw new Error('Cannot render <Frame /> without frame runtime. Use run() or pass frameInit to createRoot/createRangeRoot.');
        });
    let runtime = createFrameRuntime({
        topFrame: undefined,
        loadModule: init.loadModule ??
            (() => {
                throw new Error('loadModule is required to hydrate client entries inside <Frame />');
            }),
        resolveFrame,
        errorTarget: init.errorTarget,
        pendingClientEntries: new Map(),
        scheduler: init.scheduler,
        styleManager: init.styleManager,
        moduleCache: new Map(),
        moduleLoads: new Map(),
        frameInstances: new WeakMap(),
        namedFrames: new Map(),
    });
    runtime.canResolveFrames = !!init.resolveFrame;
    let frame = createFrameHandle({ src: init.src ?? '/', $runtime: runtime });
    runtime.topFrame = frame;
    return frame;
}
//# sourceMappingURL=vdom.js.map