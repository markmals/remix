import { createRendererScheduler, type RendererScheduler } from '../renderer.ts'
import { createDocumentState } from './document-state.ts'
import { createComponentErrorEvent } from './error-event.ts'

/** Scheduler shared by DOM roots and the frame runtime. */
export type Scheduler = RendererScheduler<Node, Element, ParentNode>

/**
 * Creates a shared renderer scheduler with DOM state preservation and error reporting.
 *
 * @param doc Document whose focus and selection must survive updates.
 * @param rootTarget Event target that receives asynchronous rendering failures.
 * @returns A scheduler that can be shared by DOM roots and frames.
 */
export function createScheduler(doc: Document, rootTarget: EventTarget): Scheduler {
  let documentState = createDocumentState(doc)
  return createRendererScheduler<Node, Element, ParentNode>({
    beforeUpdate: documentState.capture,
    beforeCommit: documentState.restore,
    reportWarning(message) {
      console.warn(`${message} Consider reducing hydration regions.`)
    },
    reportError(error) {
      console.error(error)
      rootTarget.dispatchEvent(createComponentErrorEvent(error))
    },
  })
}
