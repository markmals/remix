import type { StyleManager } from '../../style/index.ts';
import type { Scheduler } from '../scheduler.ts';
import type { RendererHost } from '../../renderer.ts';
/**
 * Creates the DOM operations `createRenderer` needs to mount Remix trees into a
 * document.
 *
 * The host owns everything that is specific to the DOM: namespaces, the
 * document head singleton, raw HTML, controlled `value`/`checked` reflection,
 * hydration of server-rendered nodes, and frames. Component and children
 * reconciliation belongs to the renderer.
 *
 * @param scheduler Scheduler the renderer batches updates through.
 * @param styles Style manager the frames this host creates render through.
 * @returns A host for `createRenderer` from `@remix-run/ui/renderer`.
 * @example
 * ```ts
 * let scheduler = createScheduler(document, window)
 * let renderer = createRenderer(createDomHost(scheduler, defaultStyleManager))
 * let root = renderer.createRoot(document.body)
 * ```
 */
export declare function createDomHost(scheduler: Scheduler, styles: StyleManager): RendererHost<Node, Element, ParentNode>;
