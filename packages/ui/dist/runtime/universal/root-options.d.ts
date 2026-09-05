import type { FrameHandle } from '../component.ts';
import type { ElementFunction } from '../element-function.ts';
import type { RendererScheduler } from './batch.ts';
import type { RendererHydrationCursor } from './capabilities.ts';
/** Host integration options for one renderer root. */
export interface RendererRootOptions<node extends object, element extends node, container extends node = element> {
    /**
     * Scheduler shared with other roots. Its creator owns asynchronous error reporting;
     * without one, this root creates a scheduler that reports through its `error` event.
     */
    scheduler?: RendererScheduler<node, element, container>;
    /** Closest frame exposed to components and mixins in this root. */
    frame?: FrameHandle;
    /** Exclusive insertion boundary; omit to append after existing container children. */
    before?: node | null;
    /** First-render adoption cursor; requires the host's hydration capability. */
    hydration?: RendererHydrationCursor<node>;
    /** Server-assigned id to reuse for an immediate root component during hydration. */
    componentId?: string;
    /**
     * Looks up a named frame in the root's runtime.
     *
     * @param name Frame name.
     * @returns The named frame, or `undefined` when it does not exist.
     */
    getFrameByName?(name: string): FrameHandle | undefined;
    /**
     * Looks up the top frame in the root's runtime.
     *
     * @returns The top frame, or `undefined` to use the closest frame.
     */
    getTopFrame?(): FrameHandle | undefined;
    /**
     * Forces a fresh component instance when its implementation has become stale.
     *
     * @param type Currently mounted component implementation.
     * @returns Whether matching component input must remount instead of updating.
     */
    shouldRemountComponent?(type: ElementFunction): boolean;
}
