import { createRendererScheduler } from '../renderer.js';
import { createDocumentState } from './document-state.js';
import { createComponentErrorEvent } from './error-event.js';
/**
 * Creates a shared renderer scheduler with DOM state preservation and error reporting.
 *
 * @param doc Document whose focus and selection must survive updates.
 * @param rootTarget Event target that receives asynchronous rendering failures.
 * @returns A scheduler that can be shared by DOM roots and frames.
 */
export function createScheduler(doc, rootTarget) {
    let documentState = createDocumentState(doc);
    return createRendererScheduler({
        beforeUpdate: documentState.capture,
        beforeCommit: documentState.restore,
        reportWarning(message) {
            console.warn(`${message} Consider reducing hydration regions.`);
        },
        reportError(error) {
            console.error(error);
            rootTarget.dispatchEvent(createComponentErrorEvent(error));
        },
    });
}
//# sourceMappingURL=scheduler.js.map