import type { ComponentHandle, Fragment, Frame, FrameProps } from '../component.ts';
import type { ElementFunction } from '../element-function.ts';
import type { Key } from '../key.ts';
import type { MixinRuntimeState } from '../mixins/mixin.ts';
import type { OnMixinDescriptor } from '../mixins/on-mixin.ts';
import type { NON_RENDER_NODE, ROOT_VNODE, RuntimeElementProps, RuntimeHostProps, TEXT_NODE } from '../vnode.ts';
import type { RendererFrame } from './capabilities.ts';
import type { DirectEventState } from './events.ts';
import type { HostPersistence } from './persistence.ts';
import type { UniversalContext } from './reconcile.ts';
/**
 * Superseded nodes keep their previous parent links while the new tree is built,
 * so reconciliation can still resolve insertion anchors through the old tree.
 */
type MountedBase<node extends object, element extends node, container extends node = element> = {
    key?: Key;
    _parent: MountedParent<node, element, container>;
};
export type MountedEmpty<node extends object, element extends node, container extends node = element> = MountedBase<node, element, container> & {
    kind: 'empty';
    type: typeof NON_RENDER_NODE;
};
export type MountedText<node extends object, element extends node, container extends node = element> = MountedBase<node, element, container> & {
    kind: 'text';
    type: typeof TEXT_NODE;
    _text: string;
    _node: node;
};
export type MountedFragment<node extends object, element extends node, container extends node = element> = MountedBase<node, element, container> & {
    kind: 'fragment';
    type: typeof Fragment;
    _children: MountedVNode<node, element, container>[];
};
export type MountedHost<node extends object, element extends node, container extends node = element> = MountedBase<node, element, container> & {
    kind: 'host';
    type: string;
    props: RuntimeHostProps;
    _children: MountedVNode<node, element, container>[];
    _node: element;
    _mixedProps: RuntimeHostProps;
    _mixState?: MixinRuntimeState;
    _shared?: boolean;
    _directEventDescriptors?: OnMixinDescriptor[];
    _directEventState?: DirectEventState;
    _persistence?: HostPersistence<element | container>;
};
/** A component's superseded node must not be rendered by a stale scheduled update. */
export type MountedComponent<node extends object, element extends node, container extends node = element> = MountedBase<node, element, container> & {
    kind: 'component';
    type: ElementFunction;
    props: RuntimeElementProps;
    _handle: ComponentHandle<unknown, element | container>;
    _content: MountedVNode<node, element, container> | null;
    _superseded: boolean;
    _context: UniversalContext<node, element, container>;
};
export type MountedFrame<node extends object, element extends node, container extends node = element> = MountedBase<node, element, container> & {
    kind: 'frame';
    type: typeof Frame;
    props: RuntimeElementProps & FrameProps;
    _frame: RendererFrame<node>;
};
/** Stable for the root's lifetime so scheduled updates see current siblings and boundaries. */
export type MountedRoot<node extends object, element extends node, container extends node = element> = {
    kind: 'root';
    type: typeof ROOT_VNODE;
    _node: container;
    _children: MountedVNode<node, element, container>[];
    _anchor?: node | null;
    _componentId?: string;
};
export type MountedVNode<node extends object, element extends node, container extends node = element> = MountedEmpty<node, element, container> | MountedText<node, element, container> | MountedFragment<node, element, container> | MountedHost<node, element, container> | MountedComponent<node, element, container> | MountedFrame<node, element, container>;
export type MountedParent<node extends object, element extends node, container extends node = element> = MountedRoot<node, element, container> | MountedFragment<node, element, container> | MountedHost<node, element, container> | MountedComponent<node, element, container>;
export declare function findFirstAnchor<node extends object, element extends node, container extends node = element>(target: MountedVNode<node, element, container> | null | undefined, isAttached?: (node: node) => boolean): node | null;
export declare function findLastAnchor<node extends object, element extends node, container extends node = element>(target: MountedVNode<node, element, container> | null | undefined, isAttached?: (node: node) => boolean): node | null;
export declare function findNextSiblingAnchor<node extends object, element extends node, container extends node = element>(target: MountedVNode<node, element, container>, resolveRootEnd?: (root: MountedRoot<node, element, container>) => node | null, isAttached?: (node: node) => boolean): node | null;
export declare function findContextValue<node extends object, element extends node, container extends node = element>(parent: MountedParent<node, element, container>, type: ElementFunction): unknown;
export declare function hasScheduledAncestor<node extends object, element extends node, container extends node = element>(target: MountedComponent<node, element, container>, batch: ReadonlyMap<MountedComponent<node, element, container>, element | container>): boolean;
export {};
