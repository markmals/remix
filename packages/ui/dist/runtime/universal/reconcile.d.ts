import type { FrameHandle } from '../component.ts';
import type { ElementFunction } from '../element-function.ts';
import type { RemixNode } from '../jsx.ts';
import type { RendererScheduler } from './batch.ts';
import type { RendererHydrationCursor } from './capabilities.ts';
import type { RendererHost } from './host.ts';
import { type MountedComponent, type MountedParent, type MountedRoot, type MountedVNode } from './vnode.ts';
/**
 * Message used wherever frame support is required but unavailable.
 *
 * Frames are a host-owned bounded range: the host resolves their content,
 * owns their markers, and keeps them updated, so a host without
 * {@link RendererHost.createFrame} rejects them instead of rendering an empty
 * region.
 */
export declare const FRAMES_UNSUPPORTED = "Frames are not supported by this renderer host; <Frame /> requires the DOM runtime";
/**
 * Per-root state the reconciler needs.
 *
 * One context is created per root and carried by every component node it
 * mounts, so a scheduler shared between roots can re-render a component
 * through the root that owns it.
 */
export interface UniversalContext<node extends object, element extends node, container extends node = element> {
    /** Closest frame exposed to components and mixins in this root. */
    readonly frame: FrameHandle;
    /** Scheduler that owns update batching for this root. */
    readonly scheduler: RendererScheduler<node, element, container>;
    /** Reconciler bound to the root's host. */
    readonly reconciler: UniversalReconciler<node, element, container>;
    /**
     * Adoption position for the root's first render. Cleared by the root once
     * that render succeeds, so later renders mount fresh nodes.
     */
    hydration?: RendererHydrationCursor<node>;
    /**
     * Allocates the next component instance id.
     *
     * @param parent Parent the component mounts under, which lets a hydrated
     * root hand its server-assigned id to its immediate child component.
     * @returns An id unique across every renderer in the process.
     */
    nextComponentId(parent: MountedParent<node, element, container>): string;
    /**
     * Looks up a named frame in the root's runtime.
     *
     * @param name Frame name.
     * @returns The named frame, or `undefined` when it does not exist.
     */
    getFrameByName(name: string): FrameHandle | undefined;
    /**
     * Looks up the top frame in the root's runtime.
     *
     * @returns The top frame, or `undefined` when the root has none.
     */
    getTopFrame(): FrameHandle | undefined;
    /**
     * Reports whether a mounted component implementation has become stale, which
     * forces a remount instead of an update. Used by hot module replacement.
     *
     * @param type Mounted component implementation.
     * @returns Whether matching component input must remount.
     */
    shouldRemountComponent?(type: ElementFunction): boolean;
    /**
     * Marks the root as mutated so the next batch commits, even when the
     * mutations happen outside a render — a mixin-only prop update or a delayed
     * removal settling after its `persistNode()` teardown.
     */
    markDirty(): void;
}
/**
 * Reconciler bound to one host.
 */
export interface UniversalReconciler<node extends object, element extends node, container extends node = element> {
    /**
     * Reconciles a root's content against a new tree.
     *
     * @param curr Currently mounted content, or `null` for the first render.
     * @param input Tree to render.
     * @param root Root the content belongs to.
     * @param context Per-root state.
     * @returns The newly committed content node.
     */
    renderRoot(curr: MountedVNode<node, element, container> | null, input: RemixNode, root: MountedRoot<node, element, container>, context: UniversalContext<node, element, container>): MountedVNode<node, element, container>;
    /**
     * Re-renders one scheduled component in place.
     *
     * @param target Component node scheduled for an update.
     * @param updateParent Parent the component renders into.
     * @param context State of the root that mounted `target`, which is the
     * context the node carries in `_context`.
     */
    updateComponent(target: MountedComponent<node, element, container>, updateParent: element | container, context: UniversalContext<node, element, container>): void;
    /**
     * Settles work waiting on an update the scheduler will not run.
     *
     * @param target Component node whose scheduled update was abandoned.
     * @param context State of the root that mounted `target`.
     */
    releaseComponent(target: MountedComponent<node, element, container>, context: UniversalContext<node, element, container>): void;
    /**
     * Removes a mounted node from the host and releases its lifetimes.
     *
     * @param target Node to remove.
     * @param context Per-root state.
     */
    removeNode(target: MountedVNode<node, element, container>, context: UniversalContext<node, element, container>): void;
}
/**
 * Creates the reconciler for a renderer host.
 *
 * Reconciliation is host-agnostic: it resolves identity, ordering, and
 * lifetimes, and expresses every mutation through {@link RendererHost}. The DOM
 * and terminal renderers share it, so component semantics (stable props, setup,
 * context, tasks, abort signals), keyed identity, fragment ranges, mixins, and
 * event binding are identical on every host. Capabilities a host does not
 * implement — frames, raw HTML, hydration, retention — are rejected rather than
 * silently skipped.
 *
 * @param host Host operations to mutate through.
 * @returns A reconciler bound to the host.
 */
export declare function createReconciler<node extends object, element extends node, container extends node = element>(host: RendererHost<node, element, container>): UniversalReconciler<node, element, container>;
