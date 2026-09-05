import { createMixin, type MixinType } from './mixin.ts'
import type { ElementProps } from '../jsx.ts'
import type { MixinDescriptor } from './mixin.ts'
import type { EnsureEvent, EventMap } from '../event-types.ts'

type SignaledListener<event extends Event> = (
  event: event,
  signal: AbortSignal,
) => void | Promise<void>

type EventType<target extends EventTarget> = string & keyof EventMap<target>

type ListenerFor<target extends EventTarget, type extends EventType<target>> = SignaledListener<
  EnsureEvent<EventMap<target>[type], target>
>
export type OnMixinDescriptor = {
  type: typeof onMixinType
  args: [type: string, handler: SignaledListener<Event>, captureBoolean?: boolean]
}

const onMixinType: MixinType<
  EventTarget,
  [type: string, handler: SignaledListener<Event>, captureBoolean?: boolean],
  ElementProps
> = (handle) => {
  let currentHandler: SignaledListener<Event> = () => {}
  let currentType = ''
  let currentCapture = false
  let currentNode: EventTarget | null = null
  let reentry: AbortController | null = null

  let stableHandler = (event: Event) => {
    reentry?.abort(new DOMException('', 'EventReentry'))
    reentry = new AbortController()
    void currentHandler(event, reentry.signal)
  }

  handle.addEventListener('insert', (event) => {
    currentNode = event.node
    currentNode.addEventListener(currentType, stableHandler, currentCapture)
  })

  handle.addEventListener('remove', () => {
    currentNode?.removeEventListener(currentType, stableHandler, currentCapture)
    currentNode = null
    reentry?.abort(new DOMException('', 'AbortError'))
  })

  return (type, handler, captureBoolean = false) => {
    let previousType = currentType
    let previousCapture = currentCapture
    let needsRebind = currentType !== type || currentCapture !== captureBoolean
    currentType = type
    currentHandler = handler
    currentCapture = captureBoolean

    if (needsRebind && currentNode) {
      currentNode.removeEventListener(previousType, stableHandler, previousCapture)
      currentNode.addEventListener(type, stableHandler, captureBoolean)
    }

    return handle.element
  }
}

const onMixin = createMixin(onMixinType)

export function isOnMixinDescriptor(descriptor: unknown): descriptor is OnMixinDescriptor {
  if (!descriptor || typeof descriptor !== 'object') return false
  let candidate = descriptor as { type?: unknown; args?: unknown }
  return candidate.type === onMixinType && Array.isArray(candidate.args)
}

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
export function on<
  target extends EventTarget = Element,
  type extends EventType<target> = EventType<target>,
>(
  type: type,
  handler: ListenerFor<target, type>,
  captureBoolean?: boolean,
): MixinDescriptor<target, [type, ListenerFor<target, type>, boolean?], ElementProps> {
  // Keep this typed wrapper so JSX host context can infer event/currentTarget
  // from `type`, rather than exposing the raw `string` + `Event` runtime signature.
  return onMixin(
    type as string,
    handler as unknown as SignaledListener<Event>,
    captureBoolean,
  ) as unknown as MixinDescriptor<target, [type, ListenerFor<target, type>, boolean?], ElementProps>
}
