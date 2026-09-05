import type { Scheduler } from '../scheduler.ts';
/**
 * Keeps the DOM `value` and `checked` state of controlled elements in sync with
 * the props that own them, restoring the prop value after user edits the app
 * did not accept.
 */
export interface ControlledReflection {
    /**
     * Reflects controlled props after children are committed and invalidates
     * pending restores from earlier input events.
     *
     * @param element Element that was just committed.
     * @param props Props the element was committed with.
     */
    finalize(element: Element, props: Readonly<Record<string, unknown>>): void;
    /**
     * Drops the state kept for an element.
     *
     * @param element Element leaving the mounted tree.
     * @param discarded True when the element is discarded with its listeners,
     *   false when it stays alive and its listeners must be detached.
     */
    release(element: Element, discarded: boolean): void;
}
/**
 * Creates the controlled-prop reflection the DOM host owns.
 *
 * @param scheduler Scheduler whose post-commit tasks attach listeners.
 * @returns Reflection hooks for the host's element lifecycle.
 */
export declare function createControlledReflection(scheduler: Scheduler): ControlledReflection;
