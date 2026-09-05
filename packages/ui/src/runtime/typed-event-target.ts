/**
 * An `EventTarget` subclass with typed event maps.
 */
export class TypedEventTarget<eventMap> extends EventTarget {}

/**
 * Interface surface for {@link TypedEventTarget} with typed listener overloads.
 */
export interface TypedEventTarget<eventMap> {
  /**
   * Type-only marker carrying the target's event map.
   *
   * Never assigned at runtime. It exists so `on(...)` and other typed helpers
   * can recover `eventMap` from a target type: the listener overloads below
   * cannot be inferred from, because the untyped fallback overload wins
   * signature inference.
   */
  readonly __rmxEvents?: eventMap

  /**
   * Adds a listener for a typed event name from the event map.
   *
   * @param type Event name to listen for.
   * @param listener Listener to invoke when the event fires.
   * @param options Listener registration options.
   */
  addEventListener<type extends Extract<keyof eventMap, string>>(
    type: type,
    listener: TypedEventListener<eventMap>[type],
    options?: AddEventListenerOptions,
  ): void
  /**
   * Adds a listener using the standard untyped `EventTarget` signature.
   *
   * @param type Event name to listen for.
   * @param listener Listener to invoke when the event fires.
   * @param options Listener registration options.
   */
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void
  /**
   * Removes a listener for a typed event name from the event map.
   *
   * @param type Event name to stop listening for.
   * @param listener Previously registered listener.
   * @param options Listener removal options.
   */
  removeEventListener<type extends Extract<keyof eventMap, string>>(
    type: type,
    listener: TypedEventListener<eventMap>[type],
    options?: EventListenerOptions,
  ): void
  /**
   * Removes a listener using the standard untyped `EventTarget` signature.
   *
   * @param type Event name to stop listening for.
   * @param listener Previously registered listener.
   * @param options Listener removal options.
   */
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions,
  ): void
}

type TypedEventListener<eventMap> = {
  [key in keyof eventMap]: (event: eventMap[key]) => void
}
