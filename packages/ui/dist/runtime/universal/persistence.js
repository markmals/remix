import { bindMixinRuntime, cancelPendingMixinRemoval, prepareMixinRemoval, } from '../mixins/mixin.js';
// Module-private, so a scope is opaque to everything but this module: hosts
// pass it around, only retention reads it.
const registry = Symbol('remix.renderer.persistence');
/**
 * Creates a retention scope to share between hosts over one node graph.
 *
 * @returns A scope to pass as the host's `persistence` capability.
 */
export function createRendererPersistence() {
    return { [registry]: { retained: new Set(), token: 0 } };
}
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
export function retainHostRemoval(persistence, target, parent) {
    let pending = prepareMixinRemoval(target._mixState);
    if (!pending)
        return null;
    let scope = persistence[registry];
    let token = ++scope.token;
    target._persistence = { parent, token };
    scope.retained.add(target);
    bindMixinRuntime(target._mixState, undefined);
    return { token, done: pending };
}
/**
 * Ends a retention so the element can finally be removed.
 *
 * @param persistence Scope the element is retained in.
 * @param target Mounted host node to release.
 * @param token Token from {@link retainHostRemoval}.
 * @returns `true` when this call ended the retention, `false` when the element
 * was already reclaimed or retained again.
 */
export function settleRetainedRemoval(persistence, target, token) {
    if (target._persistence?.token !== token)
        return false;
    target._persistence = undefined;
    persistence[registry].retained.delete(target);
    return true;
}
/**
 * Takes a retained element back into the tree.
 *
 * Cancels the `persistNode()` teardown with an aborted signal, so a mixin
 * animating the element out can react to it being reused.
 *
 * @param persistence Scope the element is retained in.
 * @param target Mounted host node being reclaimed.
 */
export function reclaimRetainedHost(persistence, target) {
    cancelPendingMixinRemoval(target._mixState);
    target._persistence = undefined;
    persistence[registry].retained.delete(target);
}
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
export function findRetainedHost(persistence, type, key, parent) {
    if (key == null)
        return null;
    for (let target of persistence[registry].retained) {
        if (target._persistence?.parent !== parent)
            continue;
        if (target.type !== type)
            continue;
        if (target.key !== key)
            continue;
        return target;
    }
    return null;
}
//# sourceMappingURL=persistence.js.map