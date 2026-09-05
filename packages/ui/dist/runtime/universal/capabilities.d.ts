import type { FrameProps } from '../component.ts';
/** Position within host-owned content being adopted by a renderer root. */
export interface RendererHydrationCursor<node extends object> {
    /** Next candidate to adopt; `undefined` abandons hydration of this sibling sequence. */
    current: node | null | undefined;
    /** Exclusive boundary that adoption and comment skipping must not cross. */
    end?: node | null;
}
/** An adopted element and the position at which its child hydration starts. */
export interface RendererHydratedElement<node extends object, element extends node> {
    /** Existing element whose initial composed props have been applied. */
    element: element;
    /** Child candidates; omit to create the element's children without adoption. */
    children?: RendererHydrationCursor<node>;
}
/** Host operations for adopting an existing tree during a root's first render. */
export interface RendererHydration<node extends object, element extends node, container extends node = element> {
    /**
     * Advances past host-owned separators without crossing the cursor's end boundary.
     *
     * @param cursor Shared position for the current sibling sequence.
     */
    normalize(cursor: RendererHydrationCursor<node>): void;
    /**
     * Adopts and corrects a text candidate, advancing the cursor when successful.
     *
     * @param text Expected text content.
     * @param parent Parent of the text being rendered.
     * @param cursor Candidate position to inspect and advance.
     * @returns The adopted node, or `null` to create a new text node.
     */
    adoptText(text: string, parent: element | container, cursor: RendererHydrationCursor<node>): node | null;
    /**
     * Adopts an element and applies its initial composed props without moving it.
     *
     * Props are borrowed and must not be retained or mutated. Advance the outer cursor
     * before returning a separate cursor for children; ignore unowned excess nodes.
     *
     * @param type Expected host tag.
     * @param props Initial composed props; ignore `children`.
     * @param parent Parent of the element being rendered.
     * @param cursor Candidate position to inspect and advance.
     * @returns The adopted element and child cursor, or `null` to create an element.
     */
    adoptElement(type: string, props: Readonly<Record<string, unknown>>, parent: element | container, cursor: RendererHydrationCursor<node>): RendererHydratedElement<node, element> | null;
}
/** A host-owned Frame range that participates in renderer ordering and removal. */
export interface RendererFrame<node extends object> {
    /** First node in the inclusive range, including any start marker. */
    readonly start: node;
    /** Last node in the inclusive range, including any end marker. */
    readonly end: node;
    /**
     * Updates frame content, preserving or replacing its range in place.
     *
     * If replacement changes the boundaries, `start` and `end` must expose the new
     * range before this method returns.
     *
     * @param props Next frame props.
     */
    update(props: FrameProps): void;
    /**
     * Releases frame resources without removing its current physical range.
     * The renderer removes that range, or its containing subtree, separately.
     */
    dispose(): void;
}
