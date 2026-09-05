// Retained elements can outlive their root and be reclaimed by another DOM host.
const states = new WeakMap();
/**
 * Creates the controlled-prop reflection the DOM host owns.
 *
 * @param scheduler Scheduler whose post-commit tasks attach listeners.
 * @returns Reflection hooks for the host's element lifecycle.
 */
export function createControlledReflection(scheduler) {
    function track(element) {
        let state = {
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
                if (!shouldRestoreOnInput(state))
                    return;
                scheduleRestore(state);
            },
            onChange() {
                scheduleRestore(state);
            },
        };
        states.set(element, state);
        // Attach after the batch commits so listeners the app registers during this
        // render run first and observe the value the user actually produced.
        scheduler.enqueueTasks([
            () => {
                if (state.disposed)
                    return;
                element.addEventListener('input', state.onInput);
                element.addEventListener('change', state.onChange);
                state.listenersAttached = true;
            },
        ]);
        return state;
    }
    return {
        finalize(element, props) {
            let state = states.get(element);
            if (state === undefined) {
                if (!isControlledProp(props, 'value') && !isControlledProp(props, 'checked'))
                    return;
                state = track(element);
            }
            state.managesValue = canManageValue(element);
            state.managesChecked = canReflectProperty(element, 'checked');
            state.hasControlledValue = state.managesValue && isControlledProp(props, 'value');
            state.controlledValue = props.value;
            state.hasControlledChecked = state.managesChecked && isControlledProp(props, 'checked');
            state.controlledChecked = props.checked;
            // Restores queued against the previous props no longer apply.
            state.pendingRestoreVersion++;
            // Creation applies props before children, and option changes can invalidate
            // a select's value even when its value prop did not change.
            restore(state);
        },
        release(element, discarded) {
            let state = states.get(element);
            if (state === undefined)
                return;
            states.delete(element);
            state.disposed = true;
            state.pendingRestoreVersion++;
            if (discarded) {
                // The listeners die with the detached element; removing them one by one
                // dominates large teardowns.
                state.listenersAttached = false;
                return;
            }
            if (state.listenersAttached) {
                element.removeEventListener('input', state.onInput);
                element.removeEventListener('change', state.onChange);
                state.listenersAttached = false;
            }
        },
    };
}
function shouldRestoreOnInput(state) {
    // Some controls dispatch `input` before `change` for the same interaction.
    // When checked/value state is typically handled on `change`, restoring on the
    // earlier `input` can race and clobber the value observed by app handlers.
    if (state.hasControlledChecked)
        return false;
    if (state.element.localName === 'select')
        return false;
    return true;
}
function scheduleRestore(state) {
    if (state.disposed)
        return;
    let version = ++state.pendingRestoreVersion;
    queueMicrotask(() => {
        if (state.disposed)
            return;
        if (state.pendingRestoreVersion !== version)
            return;
        restore(state);
    });
}
function restore(state) {
    let element = state.element;
    if (state.hasControlledValue && readProperty(element, 'value') !== state.controlledValue) {
        writeProperty(element, 'value', state.controlledValue);
    }
    if (state.hasControlledChecked && readProperty(element, 'checked') !== state.controlledChecked) {
        writeProperty(element, 'checked', state.controlledChecked);
    }
}
function isControlledProp(props, name) {
    return name in props && props[name] !== undefined;
}
function canManageValue(element) {
    // `progress` reflects a numeric value that is an attribute concern, not user
    // state to restore.
    if (element.localName === 'progress')
        return false;
    return canReflectProperty(element, 'value');
}
function canReflectProperty(element, key) {
    return key in element && !key.includes('-');
}
function readProperty(element, key) {
    if (!canReflectProperty(element, key))
        return undefined;
    return element[key];
}
function writeProperty(element, key, value) {
    if (!canReflectProperty(element, key))
        return;
    element[key] = value == null ? '' : value;
}
//# sourceMappingURL=controlled.js.map