import type { FrameHandle, FrameProps } from '../component.ts';
import type { RemixNode } from '../jsx.ts';
import type { TypedEventTarget } from '../typed-event-target.ts';
import type { RendererFrame, RendererHydration, RendererHydrationCursor } from './capabilities.ts';
import type { RendererPersistence } from './persistence.ts';
import type { RendererRootOptions } from './root-options.ts';
/**
 * Operations for mounting Remix trees onto an opaque node graph.
 *
 * DOM, terminal and custom hosts use the same reconciliation engine. `container`
 * distinguishes root containers from created elements when the platform needs it.
 * Prop bags are borrowed: never retain or mutate them, and ignore the renderer-owned
 * `children`, `mix` and `key` fields in element creation and prop updates.
 */
export interface RendererHost<node extends object, element extends node, container extends node = element> {
    /**
     * Creates an element and applies its initial composed props.
     *
     * @param type Host tag from JSX.
     * @param props Initial props; ignore renderer-owned fields.
     * @param parent Parent used to resolve host context such as document or namespace.
     * @returns The created element.
     */
    createElement(type: string, props: Readonly<Record<string, unknown>>, parent: element | container): element;
    /**
     * Creates a text node.
     *
     * @param text Initial text content.
     * @param parent Parent used to resolve host context.
     * @returns The created node.
     */
    createText(text: string, parent: element | container): node;
    /**
     * Creates an invisible positional anchor, inert in layout and output.
     *
     * @param text Debug label for the anchor.
     * @param parent Parent used to resolve host context.
     * @returns The created node.
     */
    createComment(text: string, parent: element | container): node;
    /**
     * Replaces the content of a node created by `createText`.
     *
     * @param node Text node to update.
     * @param text New text content.
     */
    setText(node: node, text: string): void;
    /**
     * Applies updated composed props, including removal of props absent from `next`.
     *
     * Called on updates, not on mount. Full bags allow related props, such as DOM
     * `class` and `className`, to be resolved together. Ignore renderer-owned fields.
     *
     * @param element Element to update.
     * @param previous Previous composed props.
     * @param next Next composed props.
     */
    patchProps(element: element, previous: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): void;
    /**
     * Inserts a node, moving it if already mounted.
     *
     * @param node Node to insert or move.
     * @param parent Parent to insert into.
     * @param before Sibling to insert before, or `null` to append.
     */
    insert(node: node, parent: element | container, before: node | null): void;
    /**
     * Detaches the top of a removed subtree; descendants need no further removals.
     * Must tolerate an already-detached node.
     *
     * @param node Node to detach.
     */
    remove(node: node): void;
    /**
     * Reads the current parent of a node.
     *
     * @param node Node to inspect.
     * @returns Its parent, or `null` when detached.
     */
    parentNode(node: node): element | container | null;
    /**
     * Reads the next sibling, including host-owned nodes outside the rendered tree.
     *
     * @param node Node to inspect.
     * @returns Its next sibling, or `null` when last.
     */
    nextSibling(node: node): node | null;
    /**
     * Publishes mutations once per batch, before component tasks and update promises.
     *
     * @param container Container of the root that changed.
     */
    commit?(container: container): void;
    /**
     * Supplies a stable event target for `mix` and its lifecycle events.
     * Hosts without this operation reject `mix` rather than ignoring it.
     *
     * @param element Element receiving mixins.
     * @returns The element's event target, which must dispatch real `Event` instances.
     */
    getEventTarget?(element: element): EventTarget;
    /**
     * Identifies host-owned singleton elements, such as `document.head`.
     * These never move or detach; only their renderer-owned children are managed.
     *
     * @param element Element to inspect.
     * @returns Whether the host retains ownership of the physical element.
     */
    isSharedElement?(element: element): boolean;
    /**
     * Applies raw HTML in place of rendered children. Hosts without it reject `innerHTML`.
     *
     * @param element Element whose content changes.
     * @param html Raw HTML, or an empty string when returning to rendered children.
     */
    setInnerHTML?(element: element, html: string): void;
    /**
     * Clears an entirely renderer-owned child list in one host operation.
     *
     * @param parent Container whose child lifetimes have already been released.
     */
    clearChildren?(parent: element | container): void;
    /**
     * Finalizes an element after its children and props, before post-commit tasks.
     * Also runs after a mixin-only prop update or retained-node reclamation.
     *
     * @param element Element being committed.
     * @param props Current composed props; ignore renderer-owned fields.
     */
    finalizeElement?(element: element, props: Readonly<Record<string, unknown>>): void;
    /**
     * Releases host-specific element resources, without detaching the element.
     *
     * @param element Element whose lifetime ended.
     * @param discarded Whether the physical element leaves with the removed subtree.
     */
    releaseElement?(element: element, discarded: boolean): void;
    /**
     * Shares deferred removal and keyed reclamation between compatible renderers.
     * Omit for immediate removal and canceled persistence.
     */
    persistence?: RendererPersistence<node, element, container>;
    /** First-render adoption operations for existing host content. */
    hydration?: RendererHydration<node, element, container>;
    /**
     * Mounts or adopts a host-owned Frame range. Hosts without it reject `Frame`.
     *
     * @param props Initial frame props.
     * @param parent Parent that owns the range.
     * @param before Exclusive insertion boundary, or `null` to append.
     * @param frame Closest frame supplied by the root.
     * @param cursor First-render adoption position, when hydrating.
     * @returns The mounted frame range and its lifecycle operations.
     */
    createFrame?(props: FrameProps, parent: element | container, before: node | null, frame: FrameHandle, cursor?: RendererHydrationCursor<node>): RendererFrame<node>;
}
/** Portable error event emitted by a renderer, without browser-only metadata. */
export interface RendererErrorEvent extends Event {
    /** The original value thrown while rendering or running queued work. */
    readonly error: unknown;
}
/**
 * Root events for scheduled updates, queued tasks, host commits and runaway loops.
 * An unhandled `error` is rethrown from a macrotask; `preventDefault()` claims it.
 * Roots using an explicitly shared scheduler use that scheduler's error policy.
 */
export type RendererRootEventMap = {
    /** An asynchronous rendering failure. */
    error: RendererErrorEvent;
};
/** Controller for one mounted tree. */
export type RendererRoot = TypedEventTarget<RendererRootEventMap> & {
    /**
     * Renders synchronously and throws reconciliation failures.
     * Throws after unmount. Mutations are not rolled back; unmount and recreate for recovery.
     *
     * @param element Tree to render.
     */
    render(element: RemixNode): void;
    /** Drains pending work; nested renders finish their enclosing batch first. */
    flush(): void;
    /** Unmounts the tree and releases its lifetimes. Idempotent. */
    unmount(): void;
};
/** Renderer bound to one host's operations. */
export interface Renderer<node extends object, element extends node = node, container extends node = element> {
    /**
     * Creates a root, appending to existing content unless adoption or a boundary is supplied.
     * The root manages only its own nodes and adopted content.
     *
     * @param container Root container.
     * @param options Host integration and scheduling options.
     * @returns A root controller.
     */
    createRoot(container: container, options?: RendererRootOptions<node, element, container>): RendererRoot;
}
