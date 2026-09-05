import { type MixinType } from './mixin.ts';
import type { ElementProps } from '../jsx.ts';
import type { MixinDescriptor } from './mixin.ts';
import type { EnsureEvent, EventMap } from '../event-types.ts';
type SignaledListener<event extends Event> = (event: event, signal: AbortSignal) => void | Promise<void>;
type EventType<target extends EventTarget> = string & keyof EventMap<target>;
type ListenerFor<target extends EventTarget, type extends EventType<target>> = SignaledListener<EnsureEvent<EventMap<target>[type], target>>;
export type OnMixinDescriptor = {
    type: typeof onMixinType;
    args: [type: string, handler: SignaledListener<Event>, captureBoolean?: boolean];
};
declare const onMixinType: MixinType<EventTarget, [
    type: string,
    handler: SignaledListener<Event>,
    captureBoolean?: boolean
], ElementProps>;
export declare function isOnMixinDescriptor(descriptor: unknown): descriptor is OnMixinDescriptor;
/**
 * Attaches a typed event handler through the mixin system.
 *
 * The target is any `EventTarget`, so the same mixin binds DOM elements and
 * the event targets a renderer host exposes. Event names and payloads come
 * from the target's event map.
 *
 * @param type Event type to listen for.
 * @param handler Event handler.
 * @param captureBoolean Whether to listen during capture.
 * @returns A mixin descriptor for the target.
 */
export declare function on<target extends EventTarget = Element, type extends EventType<target> = EventType<target>>(type: type, handler: ListenerFor<target, type>, captureBoolean?: boolean): MixinDescriptor<target, [type, ListenerFor<target, type>, boolean?], ElementProps>;
export {};
