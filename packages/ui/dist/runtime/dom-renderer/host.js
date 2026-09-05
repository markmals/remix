import { createRendererPersistence } from '../../renderer.js';
import { patchHostProps } from '../core/props.js';
import { createControlledReflection } from './controlled.js';
import { createDomFrame } from './frames.js';
import { domHydration } from './hydration.js';
import { createHostElement, getDocumentHead, getOwnerDocument, isHeadType, NO_PROPS, } from './nodes.js';
// Retention outlives the host it was created for: a frame reload replaces a
// root while nodes it persisted are still leaving the old one, so every DOM
// host shares one registry.
const domPersistence = createRendererPersistence();
/**
 * Creates the DOM operations `createRenderer` needs to mount Remix trees into a
 * document.
 *
 * The host owns everything that is specific to the DOM: namespaces, the
 * document head singleton, raw HTML, controlled `value`/`checked` reflection,
 * hydration of server-rendered nodes, and frames. Component and children
 * reconciliation belongs to the renderer.
 *
 * @param scheduler Scheduler the renderer batches updates through.
 * @param styles Style manager the frames this host creates render through.
 * @returns A host for `createRenderer` from `@remix-run/ui/renderer`.
 * @example
 * ```ts
 * let scheduler = createScheduler(document, window)
 * let renderer = createRenderer(createDomHost(scheduler, defaultStyleManager))
 * let root = renderer.createRoot(document.body)
 * ```
 */
export function createDomHost(scheduler, styles) {
    let controlled = createControlledReflection(scheduler);
    return {
        createElement(type, props, parent) {
            // A `<head>` element renders into the document's real head, which the
            // renderer treats as shared: mounted into, never inserted or removed.
            let head = isHeadType(type) ? getDocumentHead(parent) : null;
            let element = head ?? createHostElement(type, parent);
            patchHostProps(NO_PROPS, props, element);
            return element;
        },
        createText(text, parent) {
            return getOwnerDocument(parent).createTextNode(text);
        },
        createComment(text, parent) {
            return getOwnerDocument(parent).createComment(text);
        },
        setText(node, text) {
            node.nodeValue = text;
        },
        patchProps(element, previous, next) {
            patchHostProps(previous, next, element);
        },
        insert(node, parent, before) {
            if (before === null)
                parent.appendChild(node);
            else
                parent.insertBefore(node, before);
        },
        remove(node) {
            node.parentNode?.removeChild(node);
        },
        parentNode(node) {
            return node.parentNode;
        },
        nextSibling(node) {
            return node.nextSibling;
        },
        getEventTarget(element) {
            return element;
        },
        isSharedElement(element) {
            return element === element.ownerDocument.head;
        },
        setInnerHTML(element, html) {
            element.innerHTML = html;
        },
        clearChildren(parent) {
            parent.textContent = '';
        },
        finalizeElement(element, props) {
            controlled.finalize(element, props);
        },
        releaseElement(element, discarded) {
            controlled.release(element, discarded);
        },
        persistence: domPersistence,
        hydration: domHydration,
        createFrame(props, parent, before, frame, cursor) {
            return createDomFrame(props, parent, before, frame, styles, cursor);
        },
    };
}
//# sourceMappingURL=host.js.map