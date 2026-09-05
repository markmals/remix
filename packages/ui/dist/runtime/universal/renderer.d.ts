import type { Renderer, RendererHost } from './host.ts';
/**
 * Creates a renderer from host operations, without depending on DOM globals.
 *
 * DOM, terminal and custom hosts share component lifetimes, keyed reconciliation,
 * mixins and scheduling. Optional host capabilities add hydration, Frames, shared
 * elements and retained-node removal without replacing the reconciliation engine.
 *
 * @param host Operations for the target node graph.
 * @returns A renderer that creates independently owned roots.
 */
export declare function createRenderer<node extends object, element extends node, container extends node = element>(host: RendererHost<node, element, container>): Renderer<node, element, container>;
