const MAX_CASCADING_UPDATES = 50;
const NO_PARENTS = [];
/**
 * Creates a microtask-batched update scheduler.
 *
 * A batch dispatches `beforeUpdate`, runs scheduled updates, drains work and
 * commit-phase queues, commits, dispatches `commit`, and finally runs queued
 * tasks. Tasks run last so component tasks and `handle.update()` promises
 * observe committed host state; work they schedule starts another batch in the
 * same flush. Every exit path still commits and drains every queue, so a
 * failure cannot leave awaited updates pending forever.
 *
 * @param config Renderer wiring.
 * @returns A scheduler instance.
 */
export function createUpdateScheduler(config) {
    let scheduled = new Map();
    let workTasks = [];
    let commitPhase = [];
    let tasks = [];
    let flushScheduled = false;
    let flushing = false;
    let syncRenderDepth = 0;
    let mutated = false;
    let batchStarted = false;
    let updateCounts = new WeakMap();
    let resetScheduled = false;
    let cascadingUpdateCount = 0;
    let cascadingNames = config.reportWarning ? new Map() : undefined;
    let phaseEvents = new EventTarget();
    let phaseListenerCounts = { beforeUpdate: 0, commit: 0 };
    let activeParents = NO_PARENTS;
    function beginBatch() {
        if (batchStarted)
            return;
        batchStarted = true;
        try {
            config.beforeUpdate?.();
        }
        catch (error) {
            config.reportError(error);
        }
    }
    function finishMutationPhase() {
        if (!batchStarted)
            return;
        batchStarted = false;
        try {
            config.beforeCommit?.();
        }
        catch (error) {
            config.reportError(error);
        }
    }
    function scheduleFlush() {
        if (flushScheduled || flushing)
            return;
        flushScheduled = true;
        queueMicrotask(flush);
    }
    function withinUpdateBudget(entry) {
        let count = (updateCounts.get(entry) ?? 0) + 1;
        updateCounts.set(entry, count);
        if (cascadingNames) {
            let name = config.describe(entry);
            cascadingNames.set(name, (cascadingNames.get(name) ?? 0) + 1);
            cascadingUpdateCount++;
            if (cascadingUpdateCount === MAX_CASCADING_UPDATES) {
                let names = Array.from(cascadingNames, ([name, count]) => `${name} x${count}`).join(', ');
                config.reportWarning?.(`${cascadingUpdateCount} cascading component updates detected in one event loop turn. Components: ${names}`);
            }
        }
        if (!resetScheduled) {
            resetScheduled = true;
            // Reset once control returns to the event loop, so only microtask-driven
            // re-entrant flushes count as one cascade.
            setTimeout(() => {
                updateCounts = new WeakMap();
                resetScheduled = false;
                cascadingUpdateCount = 0;
                cascadingNames?.clear();
            }, 0);
        }
        if (count <= MAX_CASCADING_UPDATES)
            return true;
        config.reportError(new Error(`handle.update() infinite loop detected in ${config.describe(entry)} after ${count} cascading updates`));
        return false;
    }
    function runQueue(queue) {
        if (queue.length === 0)
            return false;
        // Entries queued while the queue runs are part of the same drain, so the
        // length is re-read every iteration instead of being captured.
        for (let index = 0; index < queue.length; index++) {
            try {
                queue[index]();
            }
            catch (error) {
                config.reportError(error);
            }
        }
        queue.length = 0;
        return true;
    }
    function dispatchPhase(type, parents) {
        if (phaseListenerCounts[type] === 0)
            return;
        let event = new Event(type);
        event.parents = parents;
        phaseEvents.dispatchEvent(event);
    }
    function pending() {
        return scheduled.size > 0 || workTasks.length > 0 || commitPhase.length > 0 || tasks.length > 0;
    }
    function runUpdates() {
        let batch = new Map(scheduled);
        scheduled.clear();
        mutated = true;
        let stopped = false;
        let failed = false;
        let skipped = null;
        for (let [entry, updateParent] of batch) {
            if (stopped) {
                config.release(entry);
                continue;
            }
            // An ancestor's render re-renders this target and drains its tasks.
            if (config.hasScheduledAncestor(entry, batch)) {
                skipped ??= [];
                skipped.push(entry);
                continue;
            }
            if (!withinUpdateBudget(entry)) {
                // Runaway component: stop rendering, but settle everything still
                // waiting on this batch so nothing is left pending.
                config.release(entry);
                stopped = true;
                continue;
            }
            try {
                config.update(entry, updateParent);
            }
            catch (error) {
                failed = true;
                config.reportError(error);
            }
        }
        if ((failed || stopped) && skipped !== null) {
            // Failed or budget-stopped ancestors never drained their descendants.
            // The reconciler ignores targets superseded by a successful render.
            for (let index = 0; index < skipped.length; index++)
                config.release(skipped[index]);
        }
        return stopped;
    }
    function flush() {
        // A render still on the stack owns this batch: draining it would dispatch
        // commit-phase lifecycles for a half-mounted subtree, publish a partial
        // tree, and run tasks the render has not produced its result for yet. The
        // `runSync` that started the outermost render drains once it returns.
        if (flushing || syncRenderDepth > 0)
            return;
        flushing = true;
        try {
            while (true) {
                flushScheduled = false;
                if (!pending() && !mutated)
                    return;
                beginBatch();
                let parents = scheduled.size > 0 ? Array.from(new Set(scheduled.values())) : NO_PARENTS;
                activeParents = parents;
                dispatchPhase('beforeUpdate', parents);
                let exhausted = scheduled.size > 0 ? runUpdates() : false;
                if (runQueue(workTasks))
                    mutated = true;
                // Work that runs from here on is not part of the update pass, so a
                // mixin lifecycle it triggers dispatches inline again.
                activeParents = NO_PARENTS;
                finishMutationPhase();
                if (runQueue(commitPhase))
                    mutated = true;
                if (mutated) {
                    mutated = false;
                    try {
                        config.commit();
                    }
                    catch (error) {
                        config.reportError(error);
                    }
                }
                dispatchPhase('commit', parents);
                runQueue(tasks);
                if (!exhausted)
                    continue;
                // A runaway component ends the flush: settle the batch it poisoned, so
                // nothing waits on a render that is not going to happen.
                for (let entry of scheduled.keys())
                    config.release(entry);
                scheduled.clear();
                runQueue(workTasks);
                runQueue(commitPhase);
                runQueue(tasks);
                // Whatever that final drain enqueued belongs to a new batch, and
                // `scheduleFlush()` cannot start one while this flush is still running.
                // Leaving it queued would strand it until an unrelated enqueue.
                if (pending()) {
                    flushScheduled = true;
                    queueMicrotask(flush);
                }
                return;
            }
        }
        finally {
            finishMutationPhase();
            activeParents = NO_PARENTS;
            flushing = false;
        }
    }
    return {
        enqueue(entry, updateParent) {
            scheduled.set(entry, updateParent);
            scheduleFlush();
        },
        enqueueWork(newTasks) {
            if (newTasks.length === 0)
                return;
            for (let index = 0; index < newTasks.length; index++)
                workTasks.push(newTasks[index]);
            scheduleFlush();
        },
        enqueueCommitPhase(newTasks) {
            if (newTasks.length === 0)
                return;
            for (let index = 0; index < newTasks.length; index++)
                commitPhase.push(newTasks[index]);
            scheduleFlush();
        },
        enqueueTasks(newTasks) {
            if (newTasks.length === 0)
                return;
            for (let index = 0; index < newTasks.length; index++)
                tasks.push(newTasks[index]);
            scheduleFlush();
        },
        addEventListener(type, listener, options) {
            phaseEvents.addEventListener(type, listener, options);
            if (listener)
                phaseListenerCounts[type] += 1;
        },
        removeEventListener(type, listener, options) {
            phaseEvents.removeEventListener(type, listener, options);
            if (listener)
                phaseListenerCounts[type] = Math.max(0, phaseListenerCounts[type] - 1);
        },
        updateParents() {
            return activeParents;
        },
        runSync(render) {
            mutated = true;
            beginBatch();
            let failure;
            // Nested renders share the batch: only the outermost one drains it, so
            // its own mutations are part of the commit the caller observes.
            syncRenderDepth++;
            try {
                render();
            }
            catch (error) {
                failure = { error };
            }
            finally {
                syncRenderDepth--;
            }
            flush();
            if (failure)
                throw failure.error;
        },
        flush,
    };
}
//# sourceMappingURL=scheduler.js.map