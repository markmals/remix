import type { Fragment, Frame, FrameProps } from './component.ts'
import type { RemixNode } from './jsx.ts'
import type { ElementFunction } from './element-function.ts'
import type { Key } from './key.ts'
import type { MixinRuntimeValue } from './mixins/mixin.ts'

export const TEXT_NODE = Symbol('TEXT_NODE')
export const NON_RENDER_NODE = Symbol('NON_RENDER_NODE')
export const ROOT_VNODE = Symbol('ROOT_VNODE')

export type VNodeKind = 'empty' | 'text' | 'fragment' | 'host' | 'component' | 'frame'

export type RuntimeElementProps = {
  [name: string]: unknown
}

export type RuntimeHostProps = RuntimeElementProps & {
  children?: RemixNode
  innerHTML?: string
  mix?: MixinRuntimeValue
}

type InputNodeBase<kind extends VNodeKind, type> = {
  kind: kind
  type: type
  key?: Key
  _parent?: never
}

export type NonRenderNode = InputNodeBase<'empty', typeof NON_RENDER_NODE>

export type TextNode = InputNodeBase<'text', typeof TEXT_NODE> & {
  _text: string
}

export type FragmentNode = InputNodeBase<'fragment', typeof Fragment> & {
  _children: VNodeInput[]
}

export type HostNode = InputNodeBase<'host', string> & {
  props: RuntimeHostProps
  _children: VNodeInput[]
}

export type ComponentNode = InputNodeBase<'component', ElementFunction> & {
  props: RuntimeElementProps
}

export type FrameNode = InputNodeBase<'frame', typeof Frame> & {
  props: RuntimeElementProps & FrameProps
}

export type VNodeInput =
  | NonRenderNode
  | TextNode
  | FragmentNode
  | HostNode
  | ComponentNode
  | FrameNode
