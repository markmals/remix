import { type UpdateScheduler } from './scheduler.ts';
import { type MountedComponent } from './vnode.ts';
/** Host lifecycle and error policy for a shared renderer scheduler. */
export interface RendererSchedulerOptions {
    /** Captures host state before the first mutation of each batch. */
    beforeUpdate?(): void;
    /** Restores host state after mutations, before commit-phase mixin lifecycles. */
    beforeCommit?(): void;
    /**
     * Reports failures from scheduled work. Without a handler, errors are rethrown
     * from a macrotask. The handler must not throw.
     *
     * @param error Failure with no synchronous caller.
     */
    reportError?(error: unknown): void;
    /**
     * Receives non-fatal diagnostics for many component updates in one event-loop turn.
     * Omit to disable these warnings.
     *
     * @param message Diagnostic message.
     */
    reportWarning?(message: string): void;
}
/** A batching scheduler that can be shared by roots using the same host node types. */
export interface RendererScheduler<node extends object, element extends node, container extends node = element> extends UpdateScheduler<MountedComponent<node, element, container>, element | container> {
    /**
     * Queues one stable root commit callback, coalescing repeated marks in a batch.
     *
     * @param commit Callback publishing a root's host mutations.
     */
    markDirty(commit: () => void): void;
}
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
export declare function createRendererScheduler<node extends object, element extends node, container extends node = element>(options?: RendererSchedulerOptions): RendererScheduler<node, element, container>;
