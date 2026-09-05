import type { MixinRuntimeValue } from '../mixins/mixin.ts';
import { type OnMixinDescriptor } from '../mixins/on-mixin.ts';
/**
 * One `on(...)` listener bound directly to an element's event target.
 *
 * `stableHandler` is created once per binding so a re-render that only changes
 * the handler function does not detach and re-attach the listener, and
 * `reentry` is the controller handed to the currently running invocation.
 */
export type DirectEventBinding = {
    type: string;
    handler: ((event: Event, signal: AbortSignal) => void | Promise<void>) | undefined;
    capture: boolean;
    reentry: AbortController | null;
    stableHandler: ((event: Event) => void) | null;
};
/**
 * Listener bindings a host element currently owns through the direct `on(...)`
 * path. Held on the mounted host node so an update can diff against them.
 */
export type DirectEventState = {
    bindings: DirectEventBinding[];
};
/**
 * Classifies a `mix` value as the direct event fast path or as full mixins.
 *
 * An element whose `mix` prop is only `on(...)` descriptors needs listeners and
 * nothing else: no mixin handle, no runners, no scheduler subscriptions. This
 * is the common case for interactive elements, so it is worth detecting before
 * the mixin runtime is instantiated.
 *
 * @param mix Value of the element's `mix` prop.
 * @returns Descriptors to bind directly, or `null` when the element needs the
 * mixin runtime.
 */
export declare function resolveDirectEventDescriptors(mix: MixinRuntimeValue | undefined): OnMixinDescriptor[] | null;
/**
 * Brings an element's direct listeners in line with its current descriptors.
 *
 * Bindings are matched positionally, which is what the descriptor array
 * already expresses: a handler swap rebinds nothing, a type or capture change
 * re-attaches only that listener, and a shorter list detaches the tail.
 *
 * @param target Event target the listeners are attached to.
 * @param descriptors Descriptors the element renders, or `undefined` when it no
 * longer uses the direct path.
 * @param state Listener state from the previous render, if any.
 * @returns The live listener state, or `undefined` when nothing is bound.
 */
export declare function syncDirectEventListeners(target: EventTarget, descriptors: OnMixinDescriptor[] | undefined, state: DirectEventState | undefined): DirectEventState | undefined;
/**
 * Detaches every direct listener from an element that stays alive.
 *
 * @param target Event target the listeners are attached to.
 * @param state Listener state to release.
 */
export declare function teardownDirectEventListeners(target: EventTarget, state: DirectEventState | undefined): void;
/**
 * Releases direct listeners of an element whose subtree is being discarded.
 *
 * Pending handler work is aborted, but the listeners themselves are left
 * attached: they die with the detached element, and detaching them one by one
 * dominates large teardowns.
 *
 * @param state Listener state to abandon.
 */
export declare function abandonDirectEventListeners(state: DirectEventState | undefined): void;
