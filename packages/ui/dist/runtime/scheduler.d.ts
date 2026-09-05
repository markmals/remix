import { type RendererScheduler } from '../renderer.ts';
/** Scheduler shared by DOM roots and the frame runtime. */
export type Scheduler = RendererScheduler<Node, Element, ParentNode>;
/**
 * Creates a shared renderer scheduler with DOM state preservation and error reporting.
 *
 * @param doc Document whose focus and selection must survive updates.
 * @param rootTarget Event target that receives asynchronous rendering failures.
 * @returns A scheduler that can be shared by DOM roots and frames.
 */
export declare function createScheduler(doc: Document, rootTarget: EventTarget): Scheduler;
