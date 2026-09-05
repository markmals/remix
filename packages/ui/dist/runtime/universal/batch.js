import { createUpdateScheduler } from './scheduler.js';
import { hasScheduledAncestor } from './vnode.js';
/**
 * Creates a scheduler for batching work across renderer roots.
 *
 * The scheduler's error handler owns asynchronous failures for all attached roots.
 * Host state is restored before mixin commit callbacks, and every dirty root is
 * published before component tasks and update promises settle.
 *
 * @param options Host batch hooks and asynchronous error reporting.
 * @returns A scheduler to supply in renderer root options.
 */
export function createRendererScheduler(options = {}) {
    let pendingCommits = new Set();
    let committing = new Set();
    let reportError = options.reportError ?? reportUnhandledError;
    let scheduler = createUpdateScheduler({
        update(target, parent) {
            let context = target._context;
            context.reconciler.updateComponent(target, parent, context);
        },
        release(target) {
            let context = target._context;
            context.reconciler.releaseComponent(target, context);
        },
        hasScheduledAncestor,
        describe(target) {
            return target.type.name || 'Anonymous';
        },
        beforeUpdate: options.beforeUpdate,
        beforeCommit: options.beforeCommit,
        reportWarning: options.reportWarning,
        commit() {
            // Swap reusable sets before callbacks, so a reentrant render belongs to
            // the next batch without allocating another snapshot on every commit.
            let previous = committing;
            committing = pendingCommits;
            pendingCommits = previous;
            try {
                for (let commit of committing) {
                    try {
                        commit();
                    }
                    catch (error) {
                        reportError(error);
                    }
                }
            }
            finally {
                committing.clear();
            }
        },
        reportError,
    });
    return Object.assign(scheduler, {
        markDirty(commit) {
            pendingCommits.add(commit);
        },
    });
}
function reportUnhandledError(error) {
    setTimeout(() => {
        throw error;
    }, 0);
}
//# sourceMappingURL=batch.js.map