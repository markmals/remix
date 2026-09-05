import type { Key } from '../key.ts';
import type { MountedHost } from './vnode.ts';
/**
 * Retention record of a host element whose removal a mixin delayed.
 *
 * `parent` is the container the element was removed from, which is what a
 * later render matches against when it reclaims the element instead of
 * mounting a new one. `token` invalidates a settled removal whose element was
 * reclaimed in the meantime.
 */
export type HostPersistence<parent extends object> = {
    parent: parent;
    token: number;
};
/**
 * A removal a mixin is holding open.
 */
export type RetainedRemoval = {
    /** Identifies this removal, so a reclaim can invalidate it. */
    token: number;
    /** Settles when every `persistNode()` teardown has finished or failed. */
    done: Promise<void>;
};
type PersistenceRegistry<node extends object, element extends node, container extends node> = {
    retained: Set<MountedHost<node, element, container>>;
    token: number;
};
declare const registry: unique symbol;
/**
 * Shared retention scope for hosts that support delayed removal.
 *
 * Elements retained by a `beforeRemove.persistNode()` teardown are reclaimed by
 * type, key, and physical parent, so every host sharing a node graph has to
 * share one scope: a frame root that is disposed while its exit animation runs
 * leaves elements behind that the next root in the same container reclaims.
 */
export interface RendererPersistence<node extends object, element extends node, container extends node = element> {
    readonly [registry]: PersistenceRegistry<node, element, container>;
}
/**
 * Creates a retention scope to share between hosts over one node graph.
 *
 * @returns A scope to pass as the host's `persistence` capability.
 */
export declare function createRendererPersistence<node extends object, element extends node, container extends node = element>(): RendererPersistence<node, element, container>;
/**
 * Asks an element's mixins to hold its removal open.
 *
 * A mixin that called `persistNode()` during `beforeRemove` keeps the element
 * in the host graph until its teardown settles. The element is registered for
 * reclaim while it waits, and its mixin runtime is unbound so it stops being an
 * update target.
 *
 * @param persistence Scope the element is retained in.
 * @param target Mounted host node being removed.
 * @param parent Container the element is being removed from.
 * @returns The pending removal, or `null` when nothing delays it.
 */
export declare function retainHostRemoval<node extends object, element extends node, container extends node>(persistence: RendererPersistence<node, element, container>, target: MountedHost<node, element, container>, parent: element | container): RetainedRemoval | null;
/**
 * Ends a retention so the element can finally be removed.
 *
 * @param persistence Scope the element is retained in.
 * @param target Mounted host node to release.
 * @param token Token from {@link retainHostRemoval}.
 * @returns `true` when this call ended the retention, `false` when the element
 * was already reclaimed or retained again.
 */
export declare function settleRetainedRemoval<node extends object, element extends node, container extends node>(persistence: RendererPersistence<node, element, container>, target: MountedHost<node, element, container>, token: number): boolean;
/**
 * Takes a retained element back into the tree.
 *
 * Cancels the `persistNode()` teardown with an aborted signal, so a mixin
 * animating the element out can react to it being reused.
 *
 * @param persistence Scope the element is retained in.
 * @param target Mounted host node being reclaimed.
 */
export declare function reclaimRetainedHost<node extends object, element extends node, container extends node>(persistence: RendererPersistence<node, element, container>, target: MountedHost<node, element, container>): void;
/**
 * Finds a retained element a new host node can reuse.
 *
 * Identity is type, key, and physical parent: an unkeyed element has no stable
 * identity across renders, so it never reclaims.
 *
 * @param persistence Scope to search.
 * @param type Host type being mounted.
 * @param key Key of the node being mounted.
 * @param parent Container the node mounts into.
 * @returns The retained node, or `null` when nothing matches.
 */
export declare function findRetainedHost<node extends object, element extends node, container extends node>(persistence: RendererPersistence<node, element, container>, type: string, key: Key | undefined, parent: element | container): MountedHost<node, element, container> | null;
export {};
