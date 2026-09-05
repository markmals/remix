import { jsx } from '../jsx.js';
import { TypedEventTarget } from '../typed-event-target.js';
import { invariant } from '../invariant.js';
export function renderMixinElement(element, props) {
    let { key, ...rest } = (props ?? {});
    return jsx(element, rest, key);
}
let mixinHandleId = 0;
/**
 * Creates a typed mixin factory that can be passed through the `mix` prop.
 *
 * @param type Mixin setup function.
 * @returns A function that captures mixin arguments and returns a descriptor.
 */
export function createMixin(type) {
    return (...args) => ({
        type: type,
        args: args,
    });
}
export function resolveMixedProps(input) {
    let state = input.state ?? createMixinRuntimeState();
    let handle = state.handle;
    if (!handle) {
        handle = new MixinHandleImpl({
            id: state.id,
            hostType: input.hostType,
            frame: input.frame,
            scheduler: input.scheduler,
            getContext: input.getContext ?? (() => undefined),
            getRuntimeSignal: () => getMixinRuntimeSignal(state),
            getBinding: () => state.binding,
        });
        state.handle = handle;
    }
    else {
        // A retained state can be reclaimed by a root that batches on its own
        // scheduler. The work this resolve queues — removed and added runners —
        // belongs to the batch that is adopting the element.
        handle.setScheduler(input.scheduler);
    }
    let hostType = input.hostType;
    let descriptors = resolveMixDescriptors(input.props);
    let composedProps = withoutMix(input.props);
    let mixinProps = withoutMixinTreeProps(composedProps);
    let maxDescriptors = 1024;
    for (let index = 0; index < descriptors.length && index < maxDescriptors; index++) {
        let descriptor = descriptors[index];
        // A descriptor is contravariant in its node type, so its setup function is
        // only callable through the runtime's own host-agnostic signature.
        let setup = descriptor.type;
        let entry = state.runners[index];
        if (!entry || entry.type !== setup) {
            if (entry) {
                queueMixinRemove(handle, entry.scope);
            }
            let scope = Symbol('mixin-scope');
            handle.setActiveScope(scope);
            entry = {
                scope,
                type: setup,
                runner: normalizeMixinRunner(setup(handle, hostType), handle),
            };
            handle.setActiveScope(undefined);
            state.runners[index] = entry;
            let binding = state.binding;
            if (binding?.node) {
                queueMixinInsert(handle, entry.scope, binding.node, binding.parent, binding.key);
            }
        }
        handle.setActiveScope(entry.scope);
        let result = entry.runner(...descriptor.args, mixinProps);
        handle.setActiveScope(undefined);
        if (!result)
            continue;
        if (isMixinElement(result))
            continue;
        let returnedDescriptors = resolveReturnedMixDescriptors(result);
        if (returnedDescriptors) {
            for (let returned of returnedDescriptors)
                descriptors.push(returned);
            continue;
        }
        if (!isRemixElement(result)) {
            console.error(new Error('mixins must return a remix element'));
            continue;
        }
        let resultType = typeof result.type === 'string'
            ? result.type
            : isMixinElement(result.type)
                ? result.type.__rmxMixinElementType
                : null;
        if (resultType !== hostType) {
            console.error(new Error('mixins must return an element with the same host type'));
            continue;
        }
        if (result.type !== resultType) {
            result = { ...result, type: resultType };
        }
        let nextProps = sanitizeReturnedMixinProps(result.props);
        let nestedDescriptors = resolveMixDescriptors(nextProps);
        for (let nested of nestedDescriptors)
            descriptors.push(nested);
        composedProps = composeMixinProps(composedProps, withoutMix(nextProps));
        mixinProps = withoutMixinTreeProps(composedProps);
    }
    for (let index = descriptors.length; index < state.runners.length; index++) {
        let entry = state.runners[index];
        if (entry) {
            handle.dispatchScopedEvent(entry.scope, new Event('remove'));
            handle.releaseScope(entry.scope);
        }
    }
    if (state.runners.length > descriptors.length) {
        state.runners.length = descriptors.length;
    }
    let nextMix = input.props.mix;
    return {
        state,
        props: {
            ...composedProps,
            ...(nextMix === undefined ? {} : { mix: nextMix }),
        },
    };
}
export function teardownMixins(state) {
    if (!state)
        return;
    state.binding = undefined;
    prepareMixinRemoval(state);
    cancelPendingMixinRemoval(state);
    let handle = state.handle;
    if (handle) {
        handle.queueCommitTask(() => finalizeMixinTeardown(state));
        return;
    }
    finalizeMixinTeardown(state);
}
export function bindMixinRuntime(state, binding, options) {
    if (!state)
        return;
    let previousNode = state.binding?.node;
    let nextBinding = binding;
    state.binding = nextBinding;
    let handle = state.handle;
    // The binding names the root that renders this element, so its scheduler
    // owns the handle's queued work and phase subscriptions from here on.
    if (handle && nextBinding)
        handle.setScheduler(nextBinding.scheduler);
    if (!nextBinding?.node || previousNode === nextBinding.node)
        return;
    let nextNode = nextBinding.node;
    if (!handle)
        return;
    for (let entry of state.runners) {
        if (options?.dispatchReclaimed) {
            queueMixinReclaimed(handle, entry.scope, nextNode, nextBinding.parent, nextBinding.key);
        }
        else {
            queueMixinInsert(handle, entry.scope, nextNode, nextBinding.parent, nextBinding.key);
        }
    }
}
export function prepareMixinRemoval(state) {
    if (!state || state.removePrepared)
        return state?.pendingRemoval?.done;
    state.removePrepared = true;
    let pendingRemoval;
    let persistTeardowns = [];
    let registerPersistNode = (teardown) => {
        persistTeardowns.push(teardown);
    };
    let handle = state.handle;
    if (!handle)
        return;
    for (let entry of state.runners) {
        dispatchMixinBeforeRemove(handle, entry.scope, registerPersistNode);
    }
    if (persistTeardowns.length > 0) {
        let controller = new AbortController();
        let done = Promise.allSettled(persistTeardowns.map((teardown) => Promise.resolve().then(() => teardown(controller.signal)))).then(() => { });
        pendingRemoval = {
            signal: controller.signal,
            cancel(reason) {
                controller.abort(reason);
            },
            done,
        };
    }
    state.pendingRemoval = pendingRemoval;
    return pendingRemoval?.done;
}
export function cancelPendingMixinRemoval(state, reason = new DOMException('', 'AbortError')) {
    if (!state?.pendingRemoval)
        return;
    state.pendingRemoval.cancel(reason);
    state.pendingRemoval = undefined;
    state.removePrepared = false;
}
function createMixinRuntimeState() {
    return {
        id: `m${++mixinHandleId}`,
        aborted: false,
        runners: [],
    };
}
class MixinHandleImpl extends TypedEventTarget {
    id;
    context;
    frame;
    element;
    #options;
    // The root that renders the element owns its batching, and a retained
    // element can be reclaimed by a root with a different scheduler.
    #scheduler;
    #phaseListenerCounts = {
        beforeUpdate: 0,
        commit: 0,
    };
    #activeScope;
    #scopeSignals = new Map();
    #scopeTargets = new Map();
    #scopePhaseCounts = new Map();
    #onSchedulerBeforeUpdate = (event) => {
        this.#dispatchSchedulerPhaseToHandle('beforeUpdate', event);
    };
    #onSchedulerCommit = (event) => {
        this.#dispatchSchedulerPhaseToHandle('commit', event);
    };
    constructor(options) {
        super();
        this.#options = options;
        this.#scheduler = options.scheduler;
        this.id = options.id;
        this.context = {
            get: options.getContext,
        };
        this.frame = options.frame;
        let element = ((_, __) => (props) => ({
            $rmx: true,
            type: options.hostType,
            key: null,
            props,
        }));
        element.__rmxMixinElementType = options.hostType;
        this.element = element;
    }
    get signal() {
        let scope = this.#activeScope;
        invariant(scope, 'handle.signal is only available during mixin setup, render, or lifecycle callbacks');
        return this.#getScopeSignal(scope);
    }
    addEventListener(type, listener, options) {
        let target = this.#getActiveScopeTarget();
        target.addEventListener(type, listener, options);
        if (!listener || !isSchedulerPhaseType(type))
            return;
        let scope = this.#activeScope;
        invariant(scope);
        let scopePhaseCounts = this.#scopePhaseCounts.get(scope);
        invariant(scopePhaseCounts);
        scopePhaseCounts[type] += 1;
        this.#phaseListenerCounts[type] += 1;
        if (this.#phaseListenerCounts[type] !== 1)
            return;
        if (type === 'beforeUpdate') {
            this.#scheduler.addEventListener('beforeUpdate', this.#onSchedulerBeforeUpdate);
        }
        else {
            this.#scheduler.addEventListener('commit', this.#onSchedulerCommit);
        }
    }
    removeEventListener(type, listener, options) {
        let target = this.#getActiveScopeTarget();
        target.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
        if (!listener || !isSchedulerPhaseType(type))
            return;
        let scope = this.#activeScope;
        invariant(scope);
        let scopePhaseCounts = this.#scopePhaseCounts.get(scope);
        invariant(scopePhaseCounts);
        scopePhaseCounts[type] = Math.max(0, scopePhaseCounts[type] - 1);
        this.#phaseListenerCounts[type] = Math.max(0, this.#phaseListenerCounts[type] - 1);
        if (this.#phaseListenerCounts[type] !== 0)
            return;
        if (type === 'beforeUpdate') {
            this.#scheduler.removeEventListener('beforeUpdate', this.#onSchedulerBeforeUpdate);
        }
        else {
            this.#scheduler.removeEventListener('commit', this.#onSchedulerCommit);
        }
    }
    update() {
        return new Promise((resolve) => {
            let signal = this.#options.getRuntimeSignal();
            if (signal.aborted) {
                resolve(signal);
                return;
            }
            let binding = this.#options.getBinding();
            if (!binding) {
                resolve(signal);
                return;
            }
            binding.enqueueUpdate(resolve);
        });
    }
    queueTask(task) {
        this.#scheduler.enqueueTasks([
            () => {
                let binding = this.#options.getBinding();
                invariant(binding);
                task(binding.node, this.#options.getRuntimeSignal());
            },
        ]);
    }
    queueCommitTask(task) {
        this.#scheduler.enqueueCommitPhase([task]);
    }
    setScheduler(scheduler) {
        if (scheduler === this.#scheduler)
            return;
        // Phase subscriptions move with the handle: the scheduler it leaves keeps
        // neither a reference to it nor a say over its lifecycles.
        if (this.#phaseListenerCounts.beforeUpdate > 0) {
            this.#scheduler.removeEventListener('beforeUpdate', this.#onSchedulerBeforeUpdate);
            scheduler.addEventListener('beforeUpdate', this.#onSchedulerBeforeUpdate);
        }
        if (this.#phaseListenerCounts.commit > 0) {
            this.#scheduler.removeEventListener('commit', this.#onSchedulerCommit);
            scheduler.addEventListener('commit', this.#onSchedulerCommit);
        }
        this.#scheduler = scheduler;
    }
    setActiveScope(scope) {
        this.#activeScope = scope;
        if (!scope)
            return;
        if (this.#scopeTargets.has(scope))
            return;
        this.#scopeTargets.set(scope, new TypedEventTarget());
        this.#scopePhaseCounts.set(scope, { beforeUpdate: 0, commit: 0 });
    }
    dispatchScopedEvent(scope, event) {
        let previousScope = this.#activeScope;
        this.#activeScope = scope;
        this.#scopeTargets.get(scope)?.dispatchEvent(event);
        this.#activeScope = previousScope;
    }
    releaseScope(scope) {
        let scopePhaseCounts = this.#scopePhaseCounts.get(scope);
        if (scopePhaseCounts) {
            this.#decrementGlobalPhaseCount('beforeUpdate', scopePhaseCounts.beforeUpdate);
            this.#decrementGlobalPhaseCount('commit', scopePhaseCounts.commit);
        }
        let controller = this.#scopeSignals.get(scope);
        if (controller) {
            controller.abort();
            this.#scopeSignals.delete(scope);
        }
        this.#scopePhaseCounts.delete(scope);
        this.#scopeTargets.delete(scope);
        if (this.#activeScope === scope) {
            this.#activeScope = undefined;
        }
    }
    #dispatchSchedulerPhaseToHandle(type, event) {
        let binding = this.#options.getBinding();
        if (!binding)
            return;
        if (!isBindingInUpdateScope(binding, event.parents))
            return;
        for (let [, target] of this.#scopeTargets) {
            let updateEvent = new Event(type);
            updateEvent.node = binding.node;
            target.dispatchEvent(updateEvent);
        }
    }
    #getActiveScopeTarget() {
        let scope = this.#activeScope;
        invariant(scope);
        let target = this.#scopeTargets.get(scope);
        invariant(target);
        return target;
    }
    #getScopeSignal(scope) {
        let controller = this.#scopeSignals.get(scope);
        if (!controller) {
            controller = new AbortController();
            this.#scopeSignals.set(scope, controller);
        }
        return controller.signal;
    }
    #decrementGlobalPhaseCount(type, amount) {
        if (amount <= 0)
            return;
        this.#phaseListenerCounts[type] = Math.max(0, this.#phaseListenerCounts[type] - amount);
        if (this.#phaseListenerCounts[type] !== 0)
            return;
        if (type === 'beforeUpdate') {
            this.#scheduler.removeEventListener('beforeUpdate', this.#onSchedulerBeforeUpdate);
        }
        else {
            this.#scheduler.removeEventListener('commit', this.#onSchedulerCommit);
        }
    }
}
export function getMixinRuntimeSignal(state) {
    let controller = state.controller;
    if (!controller) {
        controller = new AbortController();
        if (state.aborted) {
            controller.abort();
        }
        state.controller = controller;
    }
    return controller.signal;
}
export function dispatchMixinBeforeUpdate(state) {
    dispatchMixinUpdateEvent(state, 'beforeUpdate');
}
export function dispatchMixinCommit(state) {
    dispatchMixinUpdateEvent(state, 'commit');
}
function dispatchMixinInsert(handle, scope, node, parent, key) {
    let event = new Event('insert');
    event.node = node;
    event.parent = parent;
    event.key = key;
    handle.dispatchScopedEvent(scope, event);
}
function dispatchMixinReclaimed(handle, scope, node, parent, key) {
    let event = new Event('reclaimed');
    event.node = node;
    event.parent = parent;
    event.key = key;
    handle.dispatchScopedEvent(scope, event);
}
function dispatchMixinBeforeRemove(handle, scope, persistNode) {
    let event = new Event('beforeRemove');
    event.persistNode = persistNode;
    handle.dispatchScopedEvent(scope, event);
}
function queueMixinInsert(handle, scope, node, parent, key) {
    handle.queueCommitTask(() => {
        dispatchMixinInsert(handle, scope, node, parent, key);
    });
}
function queueMixinReclaimed(handle, scope, node, parent, key) {
    handle.queueCommitTask(() => {
        dispatchMixinReclaimed(handle, scope, node, parent, key);
    });
}
function queueMixinRemove(handle, scope) {
    handle.queueCommitTask(() => {
        handle.dispatchScopedEvent(scope, new Event('remove'));
        handle.releaseScope(scope);
    });
}
function dispatchMixinRemoveEvent(state) {
    let runners = state?.runners;
    if (!runners?.length)
        return;
    let handle = state?.handle;
    if (!handle)
        return;
    for (let entry of runners) {
        handle.dispatchScopedEvent(entry.scope, new Event('remove'));
    }
}
function finalizeMixinTeardown(state) {
    dispatchMixinRemoveEvent(state);
    let handle = state.handle;
    if (handle) {
        for (let entry of state.runners) {
            handle.releaseScope(entry.scope);
        }
    }
    state.runners.length = 0;
    state.aborted = true;
    state.controller?.abort();
    state.pendingRemoval = undefined;
    state.removePrepared = true;
    state.handle = undefined;
}
function dispatchMixinUpdateEvent(state, type) {
    let node = state?.binding?.node;
    if (!node)
        return;
    let runners = state?.runners;
    if (!runners?.length)
        return;
    let handle = state?.handle;
    if (!handle)
        return;
    for (let entry of runners) {
        let event = new Event(type);
        event.node = node;
        handle.dispatchScopedEvent(entry.scope, event);
    }
}
function isSchedulerPhaseType(type) {
    return type === 'beforeUpdate' || type === 'commit';
}
function isBindingInUpdateScope(binding, parents) {
    for (let index = 0; index < parents.length; index++) {
        if (binding.contains(parents[index]))
            return true;
    }
    return false;
}
function resolveMixDescriptors(props) {
    let mix = props.mix;
    if (!mix)
        return [];
    if (Array.isArray(mix)) {
        if (mix.length === 0)
            return [];
        return mix.filter(Boolean);
    }
    return [mix];
}
function withoutMix(props) {
    if (!('mix' in props))
        return props;
    let output = { ...props };
    delete output.mix;
    return output;
}
function withoutMixinTreeProps(props) {
    if (!('children' in props) && !('innerHTML' in props))
        return props;
    let output = { ...props };
    delete output.children;
    delete output.innerHTML;
    return output;
}
function sanitizeReturnedMixinProps(props) {
    if (!('children' in props) && !('innerHTML' in props))
        return props;
    console.error(new Error('mixins must not return children or innerHTML'));
    return withoutMixinTreeProps(props);
}
function composeMixinProps(previous, next) {
    return { ...previous, ...next };
}
function resolveReturnedMixDescriptors(value) {
    let descriptors = [];
    if (!collectReturnedMixDescriptors(value, descriptors)) {
        return null;
    }
    return descriptors;
}
function collectReturnedMixDescriptors(value, output) {
    if (!value) {
        return true;
    }
    if (Array.isArray(value)) {
        for (let item of value) {
            if (!collectReturnedMixDescriptors(item, output)) {
                return false;
            }
        }
        return true;
    }
    if (!isMixinDescriptor(value)) {
        return false;
    }
    output.push(value);
    return true;
}
function isRemixElement(value) {
    if (!value || typeof value !== 'object')
        return false;
    return value.$rmx === true;
}
export function isMixinDescriptor(value) {
    if (!value || typeof value !== 'object' || isRemixElement(value)) {
        return false;
    }
    let descriptor = value;
    return typeof descriptor.type === 'function' && Array.isArray(descriptor.args);
}
function isMixinElement(value) {
    if (typeof value !== 'function')
        return false;
    return '__rmxMixinElementType' in value;
}
function normalizeMixinRunner(result, handle) {
    if (typeof result === 'function' && !isMixinElement(result)) {
        return result;
    }
    if (result === undefined) {
        return () => handle.element;
    }
    return () => result;
}
//# sourceMappingURL=mixin.js.map