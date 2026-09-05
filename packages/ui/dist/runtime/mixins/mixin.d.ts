import type { Context, FrameHandle } from '../component.ts';
import type { ElementProps, RemixElement } from '../jsx.ts';
import type { Key } from '../key.ts';
import { TypedEventTarget } from '../typed-event-target.ts';
type RebindNode<value, baseNode, boundNode> = value extends (...args: infer fnArgs) => infer fnResult ? (...args: RebindTuple<fnArgs, baseNode, boundNode>) => RebindNode<fnResult, baseNode, boundNode> : [value] extends [baseNode] ? [baseNode] extends [value] ? boundNode : value : value;
type RebindTuple<args extends unknown[], baseNode, boundNode> = {
    [index in keyof args]: RebindNode<args[index], baseNode, boundNode>;
};
export type MixinProps<node extends EventTarget = Element, props extends ElementProps = ElementProps> = Omit<props, 'children' | 'innerHTML' | 'mix'> & {
    mix?: MixValue<node, props>;
};
export type MixinElement<node extends EventTarget = Element, props extends ElementProps = ElementProps> = ((handle: {
    update(): Promise<AbortSignal>;
}, setup: unknown) => (props: MixinProps<node, props>) => RemixElement) & {
    __rmxMixinElementType: string;
};
/** A mounted node and the host container it was inserted into. */
export type MixinInsertEvent<node extends EventTarget = Element> = Event & {
    node: node;
    parent: node extends Node ? ParentNode : object;
    key?: Key;
};
export type MixinReclaimedEvent<node extends EventTarget = Element> = Event & {
    node: node;
    parent: node extends Node ? ParentNode : object;
    key?: Key;
};
export type MixinUpdateEvent<node extends EventTarget = Element> = Event & {
    node: node;
};
export type MixinBeforeRemoveEvent = Event & {
    persistNode(teardown: (signal: AbortSignal) => void | Promise<void>): void;
};
type MixinContext = Pick<Context<Record<string, never>>, 'get'>;
type MixinHandleEventMap<node extends EventTarget = Element> = {
    beforeRemove: MixinBeforeRemoveEvent;
    reclaimed: MixinReclaimedEvent<node>;
    remove: Event;
    insert: MixinInsertEvent<node>;
    beforeUpdate: MixinUpdateEvent<node>;
    commit: MixinUpdateEvent<node>;
};
/**
 * Runtime handle passed to mixin setup functions.
 *
 * Mixin render callbacks receive host props with `children` and `innerHTML` removed.
 * Returned mixin elements may patch host attributes and nested `mix`, but cannot replace
 * the host subtree.
 */
export interface MixinHandle<node extends EventTarget = Element, props extends ElementProps = ElementProps> extends TypedEventTarget<MixinHandleEventMap<node>> {
    id: string;
    context: MixinContext;
    frame: FrameHandle;
    element: MixinElement<node, props>;
    signal: AbortSignal;
    update(): Promise<AbortSignal>;
    queueTask(task: (node: node, signal: AbortSignal) => void): void;
}
export declare function renderMixinElement<node extends EventTarget = Element, props extends ElementProps = ElementProps>(element: MixinElement<node, props>, props?: MixinProps<node, props>): RemixElement;
type MixinRuntimeType<args extends unknown[] = [], node extends EventTarget = Element, props extends ElementProps = ElementProps> = (handle: MixinHandle<node, props>, type: string) => ((...args: [...args, currentProps: props]) => MixinReturn<node, props>) | void;
type MixinDescriptorType<args extends unknown[] = [], node extends EventTarget = Element, props extends ElementProps = ElementProps> = <boundNode extends node>(handle: MixinHandle<boundNode, props>, type: string) => ((...args: [...args, currentProps: props]) => MixinReturn<boundNode, props>) | void;
/**
 * Public mixin setup function signature.
 */
export type MixinType<node extends EventTarget = Element, args extends unknown[] = [], props extends ElementProps = ElementProps> = (handle: MixinHandle<node, props>, type: string) => ((...args: [...args, currentProps: props]) => MixinReturn<node, props>) | void;
/**
 * Serializable descriptor stored in the `mix` prop.
 */
export type MixinDescriptor<in node extends EventTarget = Element, args extends unknown[] = [], props extends ElementProps = ElementProps> = {
    type: MixinDescriptorType<args, node, props>;
    args: args;
    readonly __node?: (node: node) => void;
};
export type MixinFactory<node extends EventTarget = Element, args extends unknown[] = [], props extends ElementProps = ElementProps> = <boundNode extends node = node>(...args: RebindTuple<args, node, boundNode>) => MixinDescriptor<boundNode, RebindTuple<args, node, boundNode>, props>;
type PreviousMixDepth = [0, 0, 1, 2, 3, 4];
type FalsyMixValue = false | 0 | 0n | '' | null | undefined;
type NullableMixValue<descriptor> = descriptor | FalsyMixValue;
type NestedMixValue<descriptor, depth extends number = 4> = depth extends 0 ? NullableMixValue<descriptor> | ReadonlyArray<NullableMixValue<descriptor>> : NullableMixValue<descriptor> | ReadonlyArray<NestedMixValue<descriptor, PreviousMixDepth[depth]>>;
type MixinInputDescriptor<in node extends EventTarget = Element, props extends ElementProps = ElementProps> = {
    type: (handle: MixinHandle<node, props>, type: string) => unknown;
    args: readonly unknown[];
    readonly __node?: (node: node) => void;
};
/**
 * Accepted authoring shape for the `mix` prop on host elements.
 */
export type MixInput<node extends EventTarget = Element, props extends ElementProps = ElementProps> = NestedMixValue<MixinInputDescriptor<node, props>>;
/**
 * Accepted value shape for the `mix` prop.
 */
export type MixValue<node extends EventTarget = Element, props extends ElementProps = ElementProps> = MixinInputDescriptor<node, props> | ReadonlyArray<MixinInputDescriptor<node, props>>;
type MixinReturn<node extends EventTarget = Element, props extends ElementProps = ElementProps> = void | null | RemixElement | MixinElement<node, props> | MixInput<node, props>;
type AnyMixinType = MixinRuntimeType<unknown[], EventTarget, ElementProps>;
type AnyMixinDescriptor = MixinDescriptor<never, unknown[], ElementProps>;
export type MixinRuntimeValue = AnyMixinDescriptor | ReadonlyArray<AnyMixinDescriptor>;
type AnyMixinRunner = (...args: [...unknown[], currentProps: ElementProps]) => MixinReturn<EventTarget, ElementProps>;
type AnyMixinHandle = MixinHandle<EventTarget, ElementProps>;
type RunnerEntry = {
    type: AnyMixinType;
    runner: AnyMixinRunner;
    scope: symbol;
};
/**
 * Phase type a scheduler dispatches around an update batch.
 */
type MixinPhaseType = 'beforeUpdate' | 'commit';
/**
 * Phase event dispatched by a scheduler around an update batch.
 *
 * `parents` names the containers whose subtrees the batch re-rendered. Which
 * bindings that covers is decided by the binding itself, so the shared runtime
 * never assumes the containers are DOM nodes.
 */
export type MixinPhaseEvent = Event & {
    parents: readonly unknown[];
};
/**
 * Scheduler operations the mixin runtime needs from a renderer.
 *
 * The DOM scheduler and the universal renderer's scheduler both implement it,
 * which is what lets one mixin lifecycle run on either host.
 */
export interface MixinScheduler {
    /** Queues work that runs inside the current batch, before it commits. */
    enqueueWork(tasks: Array<() => void>): void;
    /** Queues work that runs after mutations, before post-commit tasks. */
    enqueueCommitPhase(tasks: Array<() => void>): void;
    /** Queues work that runs after the batch commits. */
    enqueueTasks(tasks: Array<() => void>): void;
    /**
     * Subscribes to a batch phase.
     *
     * @param type Phase to listen for.
     * @param listener Listener invoked with a {@link MixinPhaseEvent}.
     * @param options Listener registration options.
     */
    addEventListener(type: MixinPhaseType, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void;
    /**
     * Unsubscribes from a batch phase.
     *
     * @param type Phase to stop listening for.
     * @param listener Previously registered listener.
     * @param options Listener removal options.
     */
    removeEventListener(type: MixinPhaseType, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void;
}
/**
 * Link between a mixin runtime state and the mounted host node it drives.
 *
 * `node` is the event target mixins observe, `parent` the container it was
 * inserted into, and `contains` answers whether a container the scheduler
 * re-rendered covers this node — the one containment question the shared
 * runtime cannot answer without knowing the host's node graph.
 */
export type MixinRuntimeBinding<target = unknown, node extends EventTarget = Element, container = ParentNode> = {
    node: node;
    parent: container;
    key?: Key;
    target: target;
    frame: FrameHandle;
    scheduler: MixinScheduler;
    enqueueUpdate(done: (signal: AbortSignal) => void): void;
    contains(container: unknown): boolean;
};
type AnyMixinRuntimeBinding = MixinRuntimeBinding<unknown, EventTarget, unknown>;
type ResolveMixedPropsInput = {
    hostType: string;
    frame: FrameHandle;
    scheduler: MixinScheduler;
    getContext?: MixinContext['get'];
    props: ElementProps;
    state?: MixinRuntimeState;
};
type ResolveMixedPropsOutput = {
    props: ElementProps;
    state: MixinRuntimeState;
};
export type MixinRuntimeState = {
    id: string;
    controller?: AbortController;
    aborted: boolean;
    handle?: AnyMixinHandle;
    runners: RunnerEntry[];
    binding?: AnyMixinRuntimeBinding;
    removePrepared?: boolean;
    pendingRemoval?: {
        signal: AbortSignal;
        cancel: (reason?: unknown) => void;
        done: Promise<void>;
    };
};
/**
 * Creates a typed mixin factory that can be passed through the `mix` prop.
 *
 * @param type Mixin setup function.
 * @returns A function that captures mixin arguments and returns a descriptor.
 */
export declare function createMixin<node extends EventTarget = Element, args extends unknown[] = [], props extends ElementProps = ElementProps>(type: MixinType<node, args, props>): MixinFactory<node, args, props>;
export declare function resolveMixedProps(input: ResolveMixedPropsInput): ResolveMixedPropsOutput;
export declare function teardownMixins(state?: MixinRuntimeState): void;
export declare function bindMixinRuntime<target, node extends EventTarget = Element, container = ParentNode>(state: MixinRuntimeState | undefined, binding?: MixinRuntimeBinding<target, node, container>, options?: {
    dispatchReclaimed?: boolean;
}): void;
export declare function prepareMixinRemoval(state?: MixinRuntimeState): Promise<void> | undefined;
export declare function cancelPendingMixinRemoval(state?: MixinRuntimeState, reason?: unknown): void;
export declare function getMixinRuntimeSignal(state: MixinRuntimeState): AbortSignal;
export declare function dispatchMixinBeforeUpdate(state?: MixinRuntimeState): void;
export declare function dispatchMixinCommit(state?: MixinRuntimeState): void;
export declare function isMixinDescriptor(value: unknown): value is AnyMixinDescriptor;
export {};
