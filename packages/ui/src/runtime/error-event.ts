/**
 * Error event shape emitted by the component runtime.
 */
export type ComponentErrorEvent = ErrorEvent & {
  readonly error: unknown
}

/**
 * Creates a normalized component error event from any thrown value.
 *
 * @param error Error-like value to expose on the event.
 * @returns An `error` event carrying the original value.
 */
export function createComponentErrorEvent(error: unknown): ComponentErrorEvent {
  return new ErrorEvent('error', { error }) as ComponentErrorEvent
}

/**
 * Creates a cancelable component error event.
 *
 * Renderer hosts that surface errors asynchronously dispatch this variant so a
 * listener can call `preventDefault()` to claim the error as handled. When no
 * listener cancels it the renderer rethrows the original value instead of
 * swallowing it.
 *
 * @param error Error-like value to expose on the event.
 * @returns A cancelable `error` event carrying the original value.
 */
export function createCancelableComponentErrorEvent(error: unknown): ComponentErrorEvent {
  return new ErrorEvent('error', { error, cancelable: true }) as ComponentErrorEvent
}

/**
 * Reads the `.error` payload from a dispatched component error event.
 *
 * @param event Event to inspect.
 * @returns The original error value, if present.
 */
export function getComponentError(event: Event): unknown {
  return (event as { error?: unknown }).error
}
