import { isOnMixinDescriptor } from '../mixins/on-mixin.js';
// A `mix` prop that resolves to nothing still takes the direct path: it needs
// no mixin runtime, and reusing one array keeps that case allocation-free.
const NO_DESCRIPTORS = [];
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
export function resolveDirectEventDescriptors(mix) {
    if (!mix)
        return NO_DESCRIPTORS;
    if (!Array.isArray(mix))
        return isOnMixinDescriptor(mix) ? [mix] : null;
    for (let index = 0; index < mix.length; index++) {
        if (!isOnMixinDescriptor(mix[index]))
            return null;
    }
    return mix;
}
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
export function syncDirectEventListeners(target, descriptors, state) {
    if (descriptors === undefined || descriptors.length === 0) {
        teardownDirectEventListeners(target, state);
        return undefined;
    }
    let live = state ?? { bindings: [] };
    let bindings = live.bindings;
    for (let index = 0; index < descriptors.length; index++) {
        // Indexed access instead of array destructuring: destructuring goes through
        // the iterator protocol and allocates on every host-node update.
        let args = descriptors[index].args;
        let type = args[0];
        let handler = args[1];
        let capture = args[2] ?? false;
        let binding = bindings[index];
        if (!binding) {
            binding = { type, handler, capture, reentry: null, stableHandler: null };
            bindings[index] = binding;
            attach(target, binding);
            continue;
        }
        if (binding.type !== type || binding.capture !== capture) {
            detach(target, binding);
            binding.type = type;
            binding.capture = capture;
            attach(target, binding);
        }
        binding.handler = handler;
    }
    for (let index = descriptors.length; index < bindings.length; index++) {
        detach(target, bindings[index]);
    }
    bindings.length = descriptors.length;
    return live;
}
/**
 * Detaches every direct listener from an element that stays alive.
 *
 * @param target Event target the listeners are attached to.
 * @param state Listener state to release.
 */
export function teardownDirectEventListeners(target, state) {
    if (!state)
        return;
    let bindings = state.bindings;
    for (let index = 0; index < bindings.length; index++) {
        detach(target, bindings[index]);
    }
    bindings.length = 0;
}
/**
 * Releases direct listeners of an element whose subtree is being discarded.
 *
 * Pending handler work is aborted, but the listeners themselves are left
 * attached: they die with the detached element, and detaching them one by one
 * dominates large teardowns.
 *
 * @param state Listener state to abandon.
 */
export function abandonDirectEventListeners(state) {
    if (!state)
        return;
    let bindings = state.bindings;
    for (let index = 0; index < bindings.length; index++) {
        bindings[index].handler = undefined;
        abortReentry(bindings[index], 'AbortError');
    }
    bindings.length = 0;
}
function attach(target, binding) {
    let stableHandler = binding.stableHandler;
    if (!stableHandler) {
        stableHandler = (event) => {
            let handler = binding.handler;
            if (!handler)
                return;
            // A second event of the same type cancels the signal the previous
            // invocation is still holding, so handlers can await without leaking a
            // stale in-flight run.
            abortReentry(binding, 'EventReentry');
            let reentry = new AbortController();
            binding.reentry = reentry;
            void handler(event, reentry.signal);
        };
        binding.stableHandler = stableHandler;
    }
    target.addEventListener(binding.type, stableHandler, binding.capture);
}
function detach(target, binding) {
    if (binding.stableHandler) {
        target.removeEventListener(binding.type, binding.stableHandler, binding.capture);
    }
    abortReentry(binding, 'AbortError');
}
function abortReentry(binding, reason) {
    binding.reentry?.abort(new DOMException('', reason));
    binding.reentry = null;
}
//# sourceMappingURL=events.js.map