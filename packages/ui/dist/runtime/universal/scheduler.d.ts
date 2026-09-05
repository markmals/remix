type EmptyFn = () => void;
type SchedulerPhaseType = 'beforeUpdate' | 'commit';
/**
 * Batches component updates and the work that must follow them.
 */
export interface UpdateScheduler<target extends object, parent extends object> {
    /** Schedules `target` for an update, coalescing repeats into one render. */
    enqueue(target: target, updateParent: parent): void;
    /** Queues callbacks to run inside the current batch, before it commits. */
    enqueueWork(tasks: EmptyFn[]): void;
    /** Queues callbacks to run after the batch's mutations, before it commits. */
    enqueueCommitPhase(tasks: EmptyFn[]): void;
    /** Queues callbacks to run after the batch commits. */
    enqueueTasks(tasks: EmptyFn[]): void;
    /**
     * Subscribes to a batch phase. Listeners receive an event whose `parents`
     * are the containers the batch re-rendered.
     *
     * @param type Phase to listen for.
     * @param listener Listener to invoke.
     * @param options Listener registration options.
     */
    addEventListener(type: SchedulerPhaseType, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void;
    /**
     * Unsubscribes from a batch phase.
     *
     * @param type Phase to stop listening for.
     * @param listener Previously registered listener.
     * @param options Listener removal options.
     */
    removeEventListener(type: SchedulerPhaseType, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void;
    /**
     * Containers whose subtrees the running batch is re-rendering. Empty outside
     * an update pass.
     */
    updateParents(): readonly parent[];
    /**
     * Runs caller-initiated reconciliation inside a batch. The batch always
     * drains, even when `work` throws, and the error is rethrown afterwards.
     *
     * A render started while another render is still on the stack — a second
     * root rendered from a component of the first, on a shared scheduler — joins
     * the outer batch instead of draining a half-built tree.
     */
    runSync(work: EmptyFn): void;
    /**
     * Drains scheduled updates, the commit, and queued tasks immediately. Does
     * nothing while a render or another drain owns the batch.
     */
    flush(): void;
}
/**
 * Wiring a scheduler needs from its renderer.
 */
export interface UpdateSchedulerConfig<target extends object, parent extends object> {
    /** Re-renders one scheduled target. */
    update(target: target, updateParent: parent): void;
    /** Settles work waiting on a target the scheduler is not going to render. */
    release(target: target): void;
    /** Reports whether an ancestor of `target` is also in the batch. */
    hasScheduledAncestor(target: target, batch: ReadonlyMap<target, parent>): boolean;
    /** Names a target for diagnostics. */
    describe(target: target): string;
    /** Receives non-fatal diagnostics for unusually many updates in one turn. */
    reportWarning?(message: string): void;
    /** Captures host state before this batch's first mutation. */
    beforeUpdate?(): void;
    /** Restores host state before commit-phase lifecycle callbacks. */
    beforeCommit?(): void;
    /** Publishes the mutations made in this batch. */
    commit(): void;
    /** Surfaces an error that cannot be thrown to a caller. */
    reportError(error: unknown): void;
}
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
export declare function createUpdateScheduler<target extends object, parent extends object>(config: UpdateSchedulerConfig<target, parent>): UpdateScheduler<target, parent>;
export {};
