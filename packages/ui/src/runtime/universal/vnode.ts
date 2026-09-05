import type { ComponentHandle, Fragment } from '../component.ts'
import type { ElementFunction } from '../element-function.ts'
import type { Key } from '../key.ts'
import type { MixinRuntimeState } from '../mixins/mixin.ts'
import type {
  NON_RENDER_NODE,
  ROOT_VNODE,
  RuntimeElementProps,
  RuntimeHostProps,
  TEXT_NODE,
} from '../vnode.ts'

/**
 * Fields shared by every mounted node.
 *
 * `_parent` always points at the parent that was live when this node was
 * committed. Superseded nodes keep their old links on purpose: reconciliation
 * builds fresh nodes for the incoming tree while the previous tree is still
 * navigable, which is how insertion anchors are resolved mid-diff.
 */
type MountedBase<node extends object, element extends node> = {
  key?: Key
  _parent: MountedParent<node, element>
}

/**
 * A node that renders nothing: `null`, `undefined`, or a boolean child.
 */
export type MountedEmpty<node extends object, element extends node> = MountedBase<node, element> & {
  kind: 'empty'
  type: typeof NON_RENDER_NODE
}

/**
 * A mounted text node.
 */
export type MountedText<node extends object, element extends node> = MountedBase<node, element> & {
  kind: 'text'
  type: typeof TEXT_NODE
  _text: string
  _node: node
}

/**
 * A mounted fragment. Fragments own a contiguous range of host nodes without
 * introducing a host element of their own.
 */
export type MountedFragment<node extends object, element extends node> = MountedBase<
  node,
  element
> & {
  kind: 'fragment'
  type: typeof Fragment
  _children: MountedVNode<node, element>[]
}

/**
 * A mounted host element.
 *
 * `props` are the props the tree rendered; `_mixedProps` are the props actually
 * applied to the element, which is what mixins compose into and what the next
 * patch diffs against. They are the same object unless the element has mixins.
 */
export type MountedHost<node extends object, element extends node> = MountedBase<node, element> & {
  kind: 'host'
  type: string
  props: RuntimeHostProps
  _children: MountedVNode<node, element>[]
  _node: element
  _mixedProps: RuntimeHostProps
  _mixState?: MixinRuntimeState
}

/**
 * A mounted component instance and the content it rendered.
 *
 * `_superseded` marks a node whose component has already been re-rendered
 * through a newer node, so a scheduled update captured against this node can
 * be dropped instead of diffing a stale content tree.
 */
export type MountedComponent<node extends object, element extends node> = MountedBase<
  node,
  element
> & {
  kind: 'component'
  type: ElementFunction
  props: RuntimeElementProps
  _handle: ComponentHandle<unknown, element>
  _content: MountedVNode<node, element> | null
  _superseded: boolean
}

/**
 * The container a renderer root renders into. Reused for the lifetime of the
 * root so scheduled updates always resolve anchors against live siblings.
 */
export type MountedRoot<node extends object, element extends node> = {
  kind: 'root'
  type: typeof ROOT_VNODE
  _node: element
  _children: MountedVNode<node, element>[]
}

/**
 * Any mounted node in a universal render tree.
 */
export type MountedVNode<node extends object, element extends node> =
  | MountedEmpty<node, element>
  | MountedText<node, element>
  | MountedFragment<node, element>
  | MountedHost<node, element>
  | MountedComponent<node, element>

/**
 * Any mounted node that can parent other mounted nodes.
 */
export type MountedParent<node extends object, element extends node> =
  | MountedRoot<node, element>
  | MountedFragment<node, element>
  | MountedHost<node, element>
  | MountedComponent<node, element>

/**
 * Finds the first host node covered by a mounted node.
 *
 * @param target Mounted node to inspect.
 * @param isAttached Optional predicate excluding detached host nodes during a diff.
 * @returns The first host node, or `null` when the node renders nothing.
 */
export function findFirstAnchor<node extends object, element extends node>(
  target: MountedVNode<node, element> | null | undefined,
  isAttached?: (node: node) => boolean,
): node | null {
  if (!target) return null
  switch (target.kind) {
    case 'text':
    case 'host':
      return !isAttached || isAttached(target._node) ? target._node : null
    case 'component':
      return findFirstAnchor(target._content, isAttached)
    case 'fragment': {
      let children = target._children
      for (let i = 0; i < children.length; i++) {
        let found = findFirstAnchor(children[i], isAttached)
        if (found) return found
      }
      return null
    }
    case 'empty':
      return null
  }
}

/**
 * Finds the last host node covered by a mounted node.
 *
 * Together with {@link findFirstAnchor} this delimits the contiguous host range
 * a fragment or component owns, which is what makes keyed moves of multi-node
 * children possible.
 *
 * @param target Mounted node to inspect.
 * @param isAttached Optional predicate excluding detached host nodes during a diff.
 * @returns The last host node, or `null` when the node renders nothing.
 */
export function findLastAnchor<node extends object, element extends node>(
  target: MountedVNode<node, element> | null | undefined,
  isAttached?: (node: node) => boolean,
): node | null {
  if (!target) return null
  switch (target.kind) {
    case 'text':
    case 'host':
      return !isAttached || isAttached(target._node) ? target._node : null
    case 'component':
      return findLastAnchor(target._content, isAttached)
    case 'fragment': {
      let children = target._children
      for (let i = children.length - 1; i >= 0; i--) {
        let found = findLastAnchor(children[i], isAttached)
        if (found) return found
      }
      return null
    }
    case 'empty':
      return null
  }
}

/**
 * Finds the host node that follows a mounted node among its siblings.
 *
 * This is the insertion anchor for content mounted at that position, and it is
 * resolved from the tree rather than cached so it is never stale. Walks out of
 * fragments and components because neither owns a host container.
 *
 * @param target Mounted node whose position is being filled.
 * @param resolveRootEnd Resolves the end of the renderer-managed range when the
 * walk reaches the root, so a late mount at the tail cannot land after
 * host-owned trailing children.
 * @param isAttached Optional predicate excluding siblings removed earlier in the diff.
 * @returns The next host node, or `null` when the node is last in its container.
 */
export function findNextSiblingAnchor<node extends object, element extends node>(
  target: MountedVNode<node, element>,
  resolveRootEnd?: (root: MountedRoot<node, element>) => node | null,
  isAttached?: (node: node) => boolean,
): node | null {
  let parent = target._parent
  if (parent.kind === 'component') return findNextSiblingAnchor(parent, resolveRootEnd, isAttached)

  let children = parent._children
  let index = children.indexOf(target)
  if (index === -1) return null

  for (let i = index + 1; i < children.length; i++) {
    let found = findFirstAnchor(children[i], isAttached)
    if (found) return found
  }

  if (parent.kind === 'fragment') return findNextSiblingAnchor(parent, resolveRootEnd, isAttached)
  if (parent.kind === 'root' && resolveRootEnd) return resolveRootEnd(parent)
  return null
}

/**
 * Reads a context value from the nearest ancestor instance of a component type.
 *
 * Ancestry crosses host elements and fragments, so context flows through the
 * whole tree rather than only through component boundaries.
 *
 * @param parent Parent to start the search from.
 * @param type Component function that provides the context.
 * @returns The provided value, or `undefined` when no ancestor provides it.
 */
export function findContextValue<node extends object, element extends node>(
  parent: MountedParent<node, element>,
  type: ElementFunction,
): unknown {
  let current: MountedParent<node, element> | undefined = parent
  while (current) {
    if (current.kind === 'component' && current.type === type) {
      return current._handle.getContextValue()
    }
    current = current.kind === 'root' ? undefined : current._parent
  }
  return undefined
}

/**
 * Reports whether an ancestor component of `target` is in the same update
 * batch, meaning that ancestor's render will re-render `target` anyway.
 *
 * @param target Scheduled component node.
 * @param batch Components scheduled in the current batch.
 * @returns `true` when an ancestor is scheduled.
 */
export function hasScheduledAncestor<node extends object, element extends node>(
  target: MountedComponent<node, element>,
  batch: ReadonlyMap<MountedComponent<node, element>, element>,
): boolean {
  let current: MountedParent<node, element> | undefined = target._parent
  while (current) {
    if (current.kind === 'component' && batch.has(current)) return true
    current = current.kind === 'root' ? undefined : current._parent
  }
  return false
}
