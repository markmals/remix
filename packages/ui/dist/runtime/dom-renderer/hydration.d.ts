import type { RendererHydration } from '../../renderer.ts';
/**
 * Hydration operations for server-rendered DOM: the renderer adopts the nodes
 * the server already produced instead of creating and inserting new ones.
 */
export declare const domHydration: RendererHydration<Node, Element, ParentNode>;
