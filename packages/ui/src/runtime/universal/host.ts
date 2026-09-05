import type { ComponentErrorEvent } from '../error-event.ts'
import type { RemixNode } from '../jsx.ts'
import type { TypedEventTarget } from '../typed-event-target.ts'

/**
 * Host operations a renderer backend implements to mount Remix trees onto an
 * arbitrary node graph.
 *
 * The renderer never touches DOM globals, so a backend can be a terminal
 * layout tree, a canvas scene graph, or a test double. Nodes are opaque to the
 * renderer: it only creates them, mutates them through these operations, and
 * asks the host how they are related.
 */
export interface RendererHost<node extends object, element extends node> {
  /**
   * Creates an element for a host tag.
   *
   * This is the only place initial props arrive: the renderer does not replay
   * {@link RendererHost.patchProp} for props present on mount, so the host must
   * apply `props` here. `props` is the live props object from the element, so it
   * may contain `children` (already reconciled by the renderer, and always to be
   * ignored here) and must not be retained or mutated.
   *
   * @param type Host tag name from JSX, e.g. `tui-box`.
   * @param props Props for the element, including `children`.
   * @returns The created element.
   */
  createElement(type: string, props: Readonly<Record<string, unknown>>): element

  /**
   * Creates a text node.
   *
   * @param text Initial text content.
   * @returns The created node.
   */
  createText(text: string): node

  /**
   * Creates an invisible node used as a positional anchor.
   *
   * The renderer inserts one of these when a node is replaced by a node of a
   * different type, so the replacement lands in the exact position of the old
   * node. It is inserted and removed inside the same batch, before
   * {@link RendererHost.commit} runs, and must be inert in layout and output.
   *
   * @param text Debug label for the anchor.
   * @returns The created node.
   */
  createComment(text: string): node

  /**
   * Replaces the text content of a node created by {@link RendererHost.createText}.
   *
   * @param node Text node to update.
   * @param text New text content.
   */
  setText(node: node, text: string): void

  /**
   * Applies a single prop change to an element.
   *
   * Only called for updates, never on mount. A removed prop arrives with
   * `next` as `undefined` and `previous` holding the old value. `children` and
   * `key` are never passed.
   *
   * @param element Element to update.
   * @param name Prop name.
   * @param previous Previous value, or `undefined` when the prop is new.
   * @param next Next value, or `undefined` when the prop was removed.
   */
  patchProp(element: element, name: string, previous: unknown, next: unknown): void

  /**
   * Inserts a node into a parent, moving it if it is already mounted.
   *
   * @param node Node to insert or move.
   * @param parent Parent to insert into.
   * @param before Sibling to insert before, or `null` to append.
   */
  insert(node: node, parent: element, before: node | null): void

  /**
   * Detaches a node from its parent.
   *
   * Called for the top of a removed subtree, so descendants are torn down
   * without further host calls. Must tolerate a node whose parent is already
   * gone.
   *
   * @param node Node to detach.
   */
  remove(node: node): void

  /**
   * Reads the current parent of a node.
   *
   * @param node Node to inspect.
   * @returns The parent element, or `null` when the node is detached.
   */
  parentNode(node: node): element | null

  /**
   * Reads the next sibling of a node.
   *
   * Used to walk a contiguous range when a multi-node fragment moves.
   *
   * @param node Node to inspect.
   * @returns The next sibling, or `null` when the node is last.
   */
  nextSibling(node: node): node | null

  /**
   * Called once per batch after every mutation, before component tasks and
   * `handle.update()` promises settle.
   *
   * Backends that paint from a scene graph should redraw here instead of
   * redrawing per mutation.
   *
   * @param container Container of the root that was rendered.
   */
  commit?(container: element): void

  /**
   * Reads the event target mixins bind to for an element.
   *
   * Implement it to support the `mix` prop: the renderer runs the shared mixin
   * runtime against the returned target, so `on(...)` handlers, mixin insert,
   * update, and remove lifecycles work exactly as they do on the DOM. A host
   * without this operation rejects every `mix` prop instead of silently
   * dropping it.
   *
   * The returned target must be stable for the lifetime of the element, and
   * events dispatched on it must be real `Event` instances. Throwing rejects
   * mixins for that element and the error surfaces from the render that
   * mounted it.
   *
   * `beforeRemove` node persistence is not supported: a mixin that calls
   * `persistNode()` during removal receives an already-aborted signal, because
   * the renderer removes the node as soon as it is unmounted.
   *
   * @param element Element the `mix` prop was applied to.
   * @returns The event target mixins observe.
   */
  getEventTarget?(element: element): EventTarget
}

/**
 * Events emitted by a renderer root.
 *
 * `error` carries failures that have no caller to throw to: a scheduled
 * component update, a queued component task, a host commit, or a runaway
 * update loop. The event is cancelable, and cancellation is the handshake:
 * calling `preventDefault()` claims the error as handled, and an error nobody
 * claims is rethrown from a macrotask so the platform reports it instead of it
 * being swallowed.
 */
export type RendererRootEventMap = {
  error: ComponentErrorEvent
}

/**
 * Controller for one mounted tree.
 */
export type RendererRoot = TypedEventTarget<RendererRootEventMap> & {
  /**
   * Renders a tree into the root's container, synchronously.
   *
   * Reconciliation errors are thrown from this call after the renderer has
   * released the lifetimes it created. Throws if the root is unmounted.
   * Host mutations are not rolled back on failure; unmount and recreate the
   * root when a clean recovery is required.
   *
   * @param element Tree to render.
   */
  render(element: RemixNode): void

  /**
   * Runs any pending component updates and tasks immediately instead of
   * waiting for the scheduled microtask.
   */
  flush(): void

  /**
   * Unmounts the tree, aborting component signals and settling pending
   * `handle.update()` promises. Idempotent.
   */
  unmount(): void
}

/**
 * Renderer bound to one {@link RendererHost}.
 */
export interface Renderer<element extends object> {
  /**
   * Creates a root that renders into `container`.
   *
   * The renderer appends to the container and only manages the nodes it
   * created, so a container may hold host-owned children.
   *
   * @param container Element to render into.
   * @returns A root controller.
   */
  createRoot(container: element): RendererRoot
}
