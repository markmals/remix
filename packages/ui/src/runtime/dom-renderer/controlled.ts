import type { Scheduler } from '../scheduler.ts'

type ControlledState = {
  element: Element
  disposed: boolean
  listenersAttached: boolean
  pendingRestoreVersion: number
  managesValue: boolean
  managesChecked: boolean
  hasControlledValue: boolean
  controlledValue: unknown
  hasControlledChecked: boolean
  controlledChecked: unknown
  onInput(): void
  onChange(): void
}

// Retained elements can outlive their root and be reclaimed by another DOM host.
const states = new WeakMap<Element, ControlledState>()

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
  finalize(element: Element, props: Readonly<Record<string, unknown>>): void
  /**
   * Drops the state kept for an element.
   *
   * @param element Element leaving the mounted tree.
   * @param discarded True when the element is discarded with its listeners,
   *   false when it stays alive and its listeners must be detached.
   */
  release(element: Element, discarded: boolean): void
}

/**
 * Creates the controlled-prop reflection the DOM host owns.
 *
 * @param scheduler Scheduler whose post-commit tasks attach listeners.
 * @returns Reflection hooks for the host's element lifecycle.
 */
export function createControlledReflection(scheduler: Scheduler): ControlledReflection {
  function track(element: Element): ControlledState {
    let state: ControlledState = {
      element,
      disposed: false,
      listenersAttached: false,
      pendingRestoreVersion: 0,
      managesValue: false,
      managesChecked: false,
      hasControlledValue: false,
      controlledValue: undefined,
      hasControlledChecked: false,
      controlledChecked: undefined,
      onInput() {
        if (!shouldRestoreOnInput(state)) return
        scheduleRestore(state)
      },
      onChange() {
        scheduleRestore(state)
      },
    }

    states.set(element, state)
    // Attach after the batch commits so listeners the app registers during this
    // render run first and observe the value the user actually produced.
    scheduler.enqueueTasks([
      () => {
        if (state.disposed) return
        element.addEventListener('input', state.onInput)
        element.addEventListener('change', state.onChange)
        state.listenersAttached = true
      },
    ])
    return state
  }

  return {
    finalize(element, props) {
      let state = states.get(element)
      if (state === undefined) {
        if (!isControlledProp(props, 'value') && !isControlledProp(props, 'checked')) return
        state = track(element)
      }

      state.managesValue = canManageValue(element)
      state.managesChecked = canReflectProperty(element, 'checked')
      state.hasControlledValue = state.managesValue && isControlledProp(props, 'value')
      state.controlledValue = props.value
      state.hasControlledChecked = state.managesChecked && isControlledProp(props, 'checked')
      state.controlledChecked = props.checked
      // Restores queued against the previous props no longer apply.
      state.pendingRestoreVersion++
      // Creation applies props before children, and option changes can invalidate
      // a select's value even when its value prop did not change.
      restore(state)
    },

    release(element, discarded) {
      let state = states.get(element)
      if (state === undefined) return

      states.delete(element)
      state.disposed = true
      state.pendingRestoreVersion++

      if (discarded) {
        // The listeners die with the detached element; removing them one by one
        // dominates large teardowns.
        state.listenersAttached = false
        return
      }

      if (state.listenersAttached) {
        element.removeEventListener('input', state.onInput)
        element.removeEventListener('change', state.onChange)
        state.listenersAttached = false
      }
    },
  }
}

function shouldRestoreOnInput(state: ControlledState): boolean {
  // Some controls dispatch `input` before `change` for the same interaction.
  // When checked/value state is typically handled on `change`, restoring on the
  // earlier `input` can race and clobber the value observed by app handlers.
  if (state.hasControlledChecked) return false
  if (state.element.localName === 'select') return false
  return true
}

function scheduleRestore(state: ControlledState): void {
  if (state.disposed) return
  let version = ++state.pendingRestoreVersion
  queueMicrotask(() => {
    if (state.disposed) return
    if (state.pendingRestoreVersion !== version) return
    restore(state)
  })
}

function restore(state: ControlledState): void {
  let element = state.element
  if (state.hasControlledValue && readProperty(element, 'value') !== state.controlledValue) {
    writeProperty(element, 'value', state.controlledValue)
  }
  if (state.hasControlledChecked && readProperty(element, 'checked') !== state.controlledChecked) {
    writeProperty(element, 'checked', state.controlledChecked)
  }
}

function isControlledProp(props: Readonly<Record<string, unknown>>, name: string): boolean {
  return name in props && props[name] !== undefined
}

function canManageValue(element: Element): boolean {
  // `progress` reflects a numeric value that is an attribute concern, not user
  // state to restore.
  if (element.localName === 'progress') return false
  return canReflectProperty(element, 'value')
}

function canReflectProperty(
  element: Element,
  key: string,
): element is Element & Record<string, unknown> {
  return key in element && !key.includes('-')
}

function readProperty(element: Element, key: string): unknown {
  if (!canReflectProperty(element, key)) return undefined
  return element[key]
}

function writeProperty(element: Element, key: string, value: unknown): void {
  if (!canReflectProperty(element, key)) return
  element[key] = value == null ? '' : value
}
