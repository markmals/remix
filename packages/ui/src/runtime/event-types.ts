import type { TypedEventTarget } from './typed-event-target.ts'

/**
 * Event type with `currentTarget` narrowed to the dispatched target.
 */
export type Dispatched<event extends Event, target extends EventTarget> = Omit<
  event,
  'currentTarget'
> & {
  currentTarget: target
}

/**
 * Narrows non-event values to `never` and preserves dispatched event typing otherwise.
 */
export type EnsureEvent<event, target extends EventTarget> = event extends Event
  ? Dispatched<event, target>
  : never

/**
 * Event map a {@link TypedEventTarget} declares, defaulting to an untyped map
 * for a target that declares none.
 */
type CustomEventMap<target extends EventTarget> =
  target extends TypedEventTarget<infer map>
    ? unknown extends map
      ? Record<string, Event>
      : NonNullable<map>
    : Record<string, Event>

/**
 * Event map resolved for an event target.
 *
 * DOM elements resolve to their built-in map, which is what keeps contextual
 * event typing in JSX unchanged. Any other target resolves to the map its
 * {@link TypedEventTarget} declares, so a renderer host that dispatches its own
 * events types `on(...)` as precisely as the DOM does.
 */
export type EventMap<target extends EventTarget> = target extends HTMLElement
  ? HTMLElementEventMap
  : target extends SVGSVGElement
    ? SVGSVGElementEventMap
    : target extends SVGElement
      ? SVGElementEventMap
      : target extends Element
        ? ElementEventMap
        : CustomEventMap<target>
