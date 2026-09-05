import type { FrameHandle, FrameProps } from '../component.ts';
import type { RendererFrame, RendererHydrationCursor } from '../../renderer.ts';
import type { StyleManager } from '../../style/index.ts';
/**
 * Mounts a `<Frame>` as a host-owned comment-bounded range.
 *
 * During hydration the server-rendered `rmx:f` markers are adopted and the
 * frame instance created by the frame runtime for those markers is reused, so
 * streamed content already in the document is never re-fetched or re-inserted.
 * Otherwise fresh markers are inserted, the fallback renders into a nested
 * range root, and the frame source is resolved asynchronously.
 *
 * @param props Frame props, including `src`, `name`, and `fallback`.
 * @param parent Parent the frame range is mounted into.
 * @param before Node the range is inserted before, or `null` to append.
 * @param frame Frame handle of the enclosing tree, which owns the frame runtime.
 * @param styles Style manager shared with the enclosing root.
 * @param cursor Hydration cursor, when the frame is mounting into server HTML.
 * @returns The renderer's handle on the mounted frame.
 */
export declare function createDomFrame(props: FrameProps, parent: ParentNode, before: Node | null, frame: FrameHandle, styles: StyleManager, cursor?: RendererHydrationCursor<Node>): RendererFrame<Node>;
/**
 * Reports whether a node is a server-rendered frame start marker.
 *
 * @param node Node to test.
 * @returns `true` for a `rmx:f:<id>` comment.
 */
export declare function isFrameStartComment(node: Node | null | undefined): node is Comment;
