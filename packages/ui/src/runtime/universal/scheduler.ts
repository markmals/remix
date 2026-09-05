import type { MixinPhaseEvent } from '../mixins/mixin.ts'

const MAX_CASCADING_UPDATES = 50

type EmptyFn = () => void
type SchedulerPhaseType = 'beforeUpdate' | 'commit'

const NO_PARENTS: readonly never[] = []

/**
 * Batches component updates and the work that must follow them.
 */
export interface UpdateScheduler<target extends object, parent extends object> {
  /** Schedules `target` for an update, coalescing repeats into one render. */
  enqueue(target: target, updateParent: parent): void
  /** Queues callbacks to run inside the current batch, before it commits. */
  enqueueWork(tasks: EmptyFn[]): void
  /** Queues callbacks to run after the batch's mutations, before it commits. */
  enqueueCommitPhase(tasks: EmptyFn[]): void
  /** Queues callbacks to run after the batch commits. */
  enqueueTasks(tasks: EmptyFn[]): void
  /**
   * Subscribes to a batch phase. Listeners receive an event whose `parents`
   * are the containers the batch re-rendered.
   *
   * @param type Phase to listen for.
   * @param listener Listener to invoke.
   * @param options Listener registration options.
   */
  addEventListener(
    type: SchedulerPhaseType,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void
  /**
   * Unsubscribes from a batch phase.
   *
   * @param type Phase to stop listening for.
   * @param listener Previously registered listener.
   * @param options Listener removal options.
   */
  removeEventListener(
    type: SchedulerPhaseType,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void
  /**
   * Containers whose subtrees the running batch is re-rendering. Empty outside
   * an update pass.
   */
  updateParents(): readonly parent[]
  /**
   * Runs caller-initiated reconciliation inside a batch. The batch always
   * drains, even when `work` throws, and the error is rethrown afterwards.
   */
  runSync(work: EmptyFn): void
  /** Drains scheduled updates, the commit, and queued tasks immediately. */
  flush(): void
}

/**
 * Wiring a scheduler needs from its renderer.
 */
export interface UpdateSchedulerConfig<target extends object, parent extends object> {
  /** Re-renders one scheduled target. */
  update(target: target, updateParent: parent): void
  /** Settles work waiting on a target the scheduler is not going to render. */
  release(target: target): void
  /** Reports whether an ancestor of `target` is also in the batch. */
  hasScheduledAncestor(target: target, batch: ReadonlyMap<target, parent>): boolean
  /** Names a target for diagnostics. */
  describe(target: target): string
  /** Publishes the mutations made in this batch. */
  commit(): void
  /** Surfaces an error that cannot be thrown to a caller. */
  reportError(error: unknown): void
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
export function createUpdateScheduler<target extends object, parent extends object>(
  config: UpdateSchedulerConfig<target, parent>,
): UpdateScheduler<target, parent> {
  let scheduled = new Map<target, parent>()
  let workTasks: EmptyFn[] = []
  let commitPhase: EmptyFn[] = []
  let tasks: EmptyFn[] = []
  let flushScheduled = false
  let flushing = false
  let mutated = false
  let updateCounts = new WeakMap<target, number>()
  let resetScheduled = false
  let phaseEvents = new EventTarget()
  let phaseListenerCounts: Record<SchedulerPhaseType, number> = { beforeUpdate: 0, commit: 0 }
  let activeParents: readonly parent[] = NO_PARENTS

  function scheduleFlush(): void {
    if (flushScheduled || flushing) return
    flushScheduled = true
    queueMicrotask(flush)
  }

  function withinUpdateBudget(entry: target): boolean {
    let count = (updateCounts.get(entry) ?? 0) + 1
    updateCounts.set(entry, count)

    if (!resetScheduled) {
      resetScheduled = true
      // Reset once control returns to the event loop, so only microtask-driven
      // re-entrant flushes count as one cascade.
      setTimeout(() => {
        updateCounts = new WeakMap()
        resetScheduled = false
      }, 0)
    }

    if (count <= MAX_CASCADING_UPDATES) return true

    config.reportError(
      new Error(
        `handle.update() infinite loop detected in ${config.describe(entry)} after ${count} cascading updates`,
      ),
    )
    return false
  }

  function runQueue(queue: EmptyFn[]): boolean {
    if (queue.length === 0) return false
    // Entries queued while the queue runs are part of the same drain, so the
    // length is re-read every iteration instead of being captured.
    for (let index = 0; index < queue.length; index++) {
      try {
        queue[index]()
      } catch (error) {
        config.reportError(error)
      }
    }
    queue.length = 0
    return true
  }

  function dispatchPhase(type: SchedulerPhaseType, parents: readonly parent[]): void {
    if (phaseListenerCounts[type] === 0) return
    let event = new Event(type) as MixinPhaseEvent
    event.parents = parents
    phaseEvents.dispatchEvent(event)
  }

  function pending(): boolean {
    return scheduled.size > 0 || workTasks.length > 0 || commitPhase.length > 0 || tasks.length > 0
  }

  function runUpdates(): boolean {
    let batch = new Map(scheduled)
    scheduled.clear()
    mutated = true
    let stopped = false
    let failed = false
    let skipped: target[] | null = null

    for (let [entry, updateParent] of batch) {
      if (stopped) {
        config.release(entry)
        continue
      }
      // An ancestor's render re-renders this target and drains its tasks.
      if (config.hasScheduledAncestor(entry, batch)) {
        skipped ??= []
        skipped.push(entry)
        continue
      }

      if (!withinUpdateBudget(entry)) {
        // Runaway component: stop rendering, but settle everything still
        // waiting on this batch so nothing is left pending.
        config.release(entry)
        stopped = true
        continue
      }

      try {
        config.update(entry, updateParent)
      } catch (error) {
        failed = true
        config.reportError(error)
      }
    }

    if ((failed || stopped) && skipped !== null) {
      // Failed or budget-stopped ancestors never drained their descendants.
      // The reconciler ignores targets superseded by a successful render.
      for (let index = 0; index < skipped.length; index++) config.release(skipped[index])
    }

    return stopped
  }

  function flush(): void {
    if (flushing) return
    flushing = true
    try {
      while (true) {
        flushScheduled = false
        if (!pending() && !mutated) return

        let parents: readonly parent[] =
          scheduled.size > 0 ? Array.from(new Set(scheduled.values())) : NO_PARENTS
        activeParents = parents
        dispatchPhase('beforeUpdate', parents)

        let exhausted = scheduled.size > 0 ? runUpdates() : false

        if (runQueue(workTasks)) mutated = true
        // Work that runs from here on is not part of the update pass, so a
        // mixin lifecycle it triggers dispatches inline again.
        activeParents = NO_PARENTS
        if (runQueue(commitPhase)) mutated = true

        if (mutated) {
          mutated = false
          try {
            config.commit()
          } catch (error) {
            config.reportError(error)
          }
        }

        dispatchPhase('commit', parents)
        runQueue(tasks)
        if (!exhausted) continue

        // A runaway component ends the flush: settle the batch it poisoned, so
        // nothing waits on a render that is not going to happen.
        for (let entry of scheduled.keys()) config.release(entry)
        scheduled.clear()
        runQueue(workTasks)
        runQueue(commitPhase)
        runQueue(tasks)

        // Whatever that final drain enqueued belongs to a new batch, and
        // `scheduleFlush()` cannot start one while this flush is still running.
        // Leaving it queued would strand it until an unrelated enqueue.
        if (pending()) {
          flushScheduled = true
          queueMicrotask(flush)
        }
        return
      }
    } finally {
      activeParents = NO_PARENTS
      flushing = false
    }
  }

  return {
    enqueue(entry: target, updateParent: parent): void {
      scheduled.set(entry, updateParent)
      scheduleFlush()
    },

    enqueueWork(newTasks: EmptyFn[]): void {
      if (newTasks.length === 0) return
      for (let index = 0; index < newTasks.length; index++) workTasks.push(newTasks[index])
      scheduleFlush()
    },

    enqueueCommitPhase(newTasks: EmptyFn[]): void {
      if (newTasks.length === 0) return
      for (let index = 0; index < newTasks.length; index++) commitPhase.push(newTasks[index])
      scheduleFlush()
    },

    enqueueTasks(newTasks: EmptyFn[]): void {
      if (newTasks.length === 0) return
      for (let index = 0; index < newTasks.length; index++) tasks.push(newTasks[index])
      scheduleFlush()
    },

    addEventListener(
      type: SchedulerPhaseType,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ): void {
      phaseEvents.addEventListener(type, listener, options)
      if (listener) phaseListenerCounts[type] += 1
    },

    removeEventListener(
      type: SchedulerPhaseType,
      listener: EventListenerOrEventListenerObject | null,
      options?: EventListenerOptions | boolean,
    ): void {
      phaseEvents.removeEventListener(type, listener, options)
      if (listener) phaseListenerCounts[type] = Math.max(0, phaseListenerCounts[type] - 1)
    },

    updateParents(): readonly parent[] {
      return activeParents
    },

    runSync(render: EmptyFn): void {
      mutated = true
      let failure: { error: unknown } | undefined
      try {
        render()
      } catch (error) {
        failure = { error }
      }
      flush()
      if (failure) throw failure.error
    },

    flush,
  }
}
