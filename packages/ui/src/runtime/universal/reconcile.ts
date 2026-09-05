import { createComponent } from '../component.ts'
import type { FrameHandle } from '../component.ts'
import {
  analyzeKeyedChildMatches,
  hasKeyedChildren,
  lisMatches,
  matchKeyedChildren,
  warnDuplicateKeys,
} from '../core/keyed-children.ts'
import type { ElementFunction } from '../element-function.ts'
import type { ElementType, RemixNode } from '../jsx.ts'
import {
  bindMixinRuntime,
  dispatchMixinBeforeUpdate,
  dispatchMixinCommit,
  getMixinRuntimeSignal,
  resolveMixedProps,
  teardownMixins,
  type MixinRuntimeBinding,
  type MixinRuntimeState,
} from '../mixins/mixin.ts'
import type { OnMixinDescriptor } from '../mixins/on-mixin.ts'
import { toVNode } from '../to-vnode.ts'
import type { ComponentNode, FrameNode, HostNode, RuntimeHostProps, VNodeInput } from '../vnode.ts'
import type { RendererScheduler } from './batch.ts'
import type { RendererHydrationCursor } from './capabilities.ts'
import {
  abandonDirectEventListeners,
  resolveDirectEventDescriptors,
  syncDirectEventListeners,
  teardownDirectEventListeners,
} from './events.ts'
import type { RendererHost } from './host.ts'
import {
  findRetainedHost,
  reclaimRetainedHost,
  retainHostRemoval,
  settleRetainedRemoval,
} from './persistence.ts'
import {
  findContextValue,
  findFirstAnchor,
  findLastAnchor,
  findNextSiblingAnchor,
  type MountedComponent,
  type MountedFragment,
  type MountedFrame,
  type MountedHost,
  type MountedParent,
  type MountedRoot,
  type MountedText,
  type MountedVNode,
} from './vnode.ts'

/**
 * Message used wherever frame support is required but unavailable.
 *
 * Frames are a host-owned bounded range: the host resolves their content,
 * owns their markers, and keeps them updated, so a host without
 * {@link RendererHost.createFrame} rejects them instead of rendering an empty
 * region.
 */
export const FRAMES_UNSUPPORTED =
  'Frames are not supported by this renderer host; <Frame /> requires the DOM runtime'

/**
 * Builds the message for a `mix` prop on a host that cannot bind mixins.
 *
 * Mixins and `on(...)` listeners observe an event target, so a host has to
 * expose one through {@link RendererHost.getEventTarget} before either can bind
 * to its elements.
 *
 * @param type Host type the `mix` prop was used on.
 * @returns The error message.
 */
function mixinsUnsupported(type: string): string {
  return `Mixins are not supported by this renderer host; remove mix from <${type} /> or implement host.getEventTarget`
}

/**
 * Builds the message for an `innerHTML` prop on a host without raw content.
 *
 * @param type Host type the `innerHTML` prop was used on.
 * @returns The error message.
 */
function rawHtmlUnsupported(type: string): string {
  return `innerHTML is not supported by this renderer host; remove innerHTML from <${type} />`
}

/**
 * Per-root state the reconciler needs.
 *
 * One context is created per root and carried by every component node it
 * mounts, so a scheduler shared between roots can re-render a component
 * through the root that owns it.
 */
export interface UniversalContext<
  node extends object,
  element extends node,
  container extends node = element,
> {
  /** Closest frame exposed to components and mixins in this root. */
  readonly frame: FrameHandle
  /** Scheduler that owns update batching for this root. */
  readonly scheduler: RendererScheduler<node, element, container>
  /** Reconciler bound to the root's host. */
  readonly reconciler: UniversalReconciler<node, element, container>
  /**
   * Adoption position for the root's first render. Cleared by the root once
   * that render succeeds, so later renders mount fresh nodes.
   */
  hydration?: RendererHydrationCursor<node>

  /**
   * Allocates the next component instance id.
   *
   * @param parent Parent the component mounts under, which lets a hydrated
   * root hand its server-assigned id to its immediate child component.
   * @returns An id unique across every renderer in the process.
   */
  nextComponentId(parent: MountedParent<node, element, container>): string

  /**
   * Looks up a named frame in the root's runtime.
   *
   * @param name Frame name.
   * @returns The named frame, or `undefined` when it does not exist.
   */
  getFrameByName(name: string): FrameHandle | undefined

  /**
   * Looks up the top frame in the root's runtime.
   *
   * @returns The top frame, or `undefined` when the root has none.
   */
  getTopFrame(): FrameHandle | undefined

  /**
   * Reports whether a mounted component implementation has become stale, which
   * forces a remount instead of an update. Used by hot module replacement.
   *
   * @param type Mounted component implementation.
   * @returns Whether matching component input must remount.
   */
  shouldRemountComponent?(type: ElementFunction): boolean

  /**
   * Marks the root as mutated so the next batch commits, even when the
   * mutations happen outside a render — a mixin-only prop update or a delayed
   * removal settling after its `persistNode()` teardown.
   */
  markDirty(): void
}

/**
 * Reconciler bound to one host.
 */
export interface UniversalReconciler<
  node extends object,
  element extends node,
  container extends node = element,
> {
  /**
   * Reconciles a root's content against a new tree.
   *
   * @param curr Currently mounted content, or `null` for the first render.
   * @param input Tree to render.
   * @param root Root the content belongs to.
   * @param context Per-root state.
   * @returns The newly committed content node.
   */
  renderRoot(
    curr: MountedVNode<node, element, container> | null,
    input: RemixNode,
    root: MountedRoot<node, element, container>,
    context: UniversalContext<node, element, container>,
  ): MountedVNode<node, element, container>

  /**
   * Re-renders one scheduled component in place.
   *
   * @param target Component node scheduled for an update.
   * @param updateParent Parent the component renders into.
   * @param context State of the root that mounted `target`, which is the
   * context the node carries in `_context`.
   */
  updateComponent(
    target: MountedComponent<node, element, container>,
    updateParent: element | container,
    context: UniversalContext<node, element, container>,
  ): void

  /**
   * Settles work waiting on an update the scheduler will not run.
   *
   * @param target Component node whose scheduled update was abandoned.
   * @param context State of the root that mounted `target`.
   */
  releaseComponent(
    target: MountedComponent<node, element, container>,
    context: UniversalContext<node, element, container>,
  ): void

  /**
   * Removes a mounted node from the host and releases its lifetimes.
   *
   * @param target Node to remove.
   * @param context Per-root state.
   */
  removeNode(
    target: MountedVNode<node, element, container>,
    context: UniversalContext<node, element, container>,
  ): void
}

/**
 * Creates the reconciler for a renderer host.
 *
 * Reconciliation is host-agnostic: it resolves identity, ordering, and
 * lifetimes, and expresses every mutation through {@link RendererHost}. The DOM
 * and terminal renderers share it, so component semantics (stable props, setup,
 * context, tasks, abort signals), keyed identity, fragment ranges, mixins, and
 * event binding are identical on every host. Capabilities a host does not
 * implement — frames, raw HTML, hydration, retention — are rejected rather than
 * silently skipped.
 *
 * @param host Host operations to mutate through.
 * @returns A reconciler bound to the host.
 */
export function createReconciler<
  node extends object,
  element extends node,
  container extends node = element,
>(host: RendererHost<node, element, container>): UniversalReconciler<node, element, container> {
  type Mounted = MountedVNode<node, element, container>
  type Parent = MountedParent<node, element, container>
  type Context = UniversalContext<node, element, container>
  type Host = MountedHost<node, element, container>
  type HostParent = element | container
  type Cursor = RendererHydrationCursor<node> | undefined

  // Placeholder for `_children` between creating a node and reconciling its
  // children, which need the node as their parent. Never mutated.
  let noChildren: Mounted[] = []

  function mount(
    next: VNodeInput,
    parent: HostParent,
    vParent: Parent,
    context: Context,
    anchor: node | null,
    cursor: Cursor,
  ): Mounted {
    // Hydration candidates are host-owned content, so the host decides what
    // separates two rendered siblings and where its adoption range ends.
    if (cursor) host.hydration?.normalize(cursor)

    switch (next.kind) {
      case 'empty': {
        return { kind: 'empty', type: next.type, key: next.key, _parent: vParent }
      }

      case 'text': {
        let adopted = cursor
          ? (host.hydration?.adoptText(next._text, parent, cursor) ?? null)
          : null
        let textNode = adopted
        if (textNode === null) {
          textNode = host.createText(next._text, parent)
          host.insert(textNode, parent, anchor)
        }
        return {
          kind: 'text',
          type: next.type,
          key: next.key,
          _text: next._text,
          _node: textNode,
          _parent: vParent,
        }
      }

      case 'fragment': {
        let mounted: MountedFragment<node, element, container> = {
          kind: 'fragment',
          type: next.type,
          key: next.key,
          _children: noChildren,
          _parent: vParent,
        }
        mounted._children = diffChildren(
          null,
          next._children,
          parent,
          mounted,
          context,
          anchor,
          cursor,
        )
        return mounted
      }

      case 'host': {
        return mountHost(next, parent, vParent, context, anchor, cursor)
      }

      case 'component': {
        return diffComponent(null, next, parent, vParent, context, anchor, cursor)
      }

      case 'frame': {
        return mountFrame(next, parent, vParent, context, anchor, cursor)
      }
    }
  }

  function mountHost(
    next: HostNode,
    parent: HostParent,
    vParent: Parent,
    context: Context,
    anchor: node | null,
    cursor: Cursor,
  ): Host {
    let persistence = host.persistence
    if (persistence) {
      // A keyed element whose removal a mixin is still holding open is reused
      // instead of rebuilt, so an exit animation that is reversed keeps its
      // node, its state, and its running effects.
      let retained = findRetainedHost<node, element, container>(
        persistence,
        next.type,
        next.key,
        parent,
      )
      if (retained) {
        // The element never left the host tree, but the region it rejoins can
        // expect it somewhere else: every other node this mount produces lands
        // before `anchor`, so leaving the reclaimed one where it was would put
        // the tree and the host in different orders.
        reclaimRetainedHost(persistence, retained)
        try {
          placeReclaimed(retained, parent, anchor)
          return diffHost(retained, next, parent, vParent, context, true)
        } catch (error) {
          // The old removal no longer owns this element, and the failed mount
          // never joined the new tree. Release it without starting another exit.
          detachHost(retained, context)
          throw error
        }
      }
    }

    let resolved = resolveHostProps(next.type, next.props, vParent, context)
    let mounted: Host | undefined

    try {
      let adopted = cursor
        ? (host.hydration?.adoptElement(next.type, resolved.props, parent, cursor) ?? null)
        : null
      // Creation is parent-aware so the host can resolve its own context, such
      // as an owner document or an XML namespace, from where the element lands.
      let hostNode = adopted
        ? adopted.element
        : host.createElement(next.type, resolved.props, parent)
      // A shared element is owned by the host, not by this tree: it is never
      // inserted, moved, or detached, and only its rendered children are ours.
      let shared = host.isSharedElement?.(hostNode) === true
      mounted = {
        kind: 'host',
        type: next.type,
        key: next.key,
        props: next.props,
        _children: noChildren,
        _node: hostNode,
        _parent: vParent,
        _mixedProps: resolved.props,
        _mixState: resolved.state,
        _directEventDescriptors: resolved.directEvents,
        _shared: shared,
      }

      let html = rawHtml(resolved.props)
      if (html === undefined) {
        mounted._children = diffChildren(
          null,
          next._children,
          hostNode,
          mounted,
          context,
          null,
          adopted?.children,
        )
      } else {
        applyRawHtml(mounted, html)
      }

      syncHostEvents(mounted)
      host.finalizeElement?.(hostNode, resolved.props)
      if (!adopted && !shared) host.insert(hostNode, parent, anchor)
      bindHostMixins(mounted, parent, context)
      return mounted
    } catch (error) {
      if (mounted) removeNode(mounted, context)
      else teardownMixins(resolved.state)
      throw error
    }
  }

  function mountFrame(
    next: FrameNode,
    parent: HostParent,
    vParent: Parent,
    context: Context,
    anchor: node | null,
    cursor: Cursor,
  ): MountedFrame<node, element, container> {
    let createFrame = host.createFrame
    if (!createFrame) throw new Error(FRAMES_UNSUPPORTED)

    return {
      kind: 'frame',
      type: next.type,
      key: next.key,
      props: next.props,
      _frame: createFrame(next.props, parent, anchor, context.frame, cursor),
      _parent: vParent,
    }
  }

  function diff(
    curr: Mounted | null,
    next: VNodeInput,
    parent: HostParent,
    vParent: Parent,
    context: Context,
    anchor: node | null,
    cursor: Cursor,
  ): Mounted {
    if (curr === null) return mount(next, parent, vParent, context, anchor, cursor)

    if (curr.kind !== next.kind || curr.type !== next.type) {
      return replace(curr, next, parent, vParent, context, anchor)
    }

    // A component whose implementation was replaced by hot module replacement
    // cannot update in place: its setup has to run again.
    if (curr.kind === 'component' && context.shouldRemountComponent?.(curr.type) === true) {
      return replace(curr, next, parent, vParent, context, anchor)
    }

    // Matching kind and type make the mounted node's shape known, which the
    // union discriminants alone cannot express for two parallel unions.
    switch (next.kind) {
      case 'empty': {
        return { kind: 'empty', type: next.type, key: next.key, _parent: vParent }
      }

      case 'text': {
        let text = curr as MountedText<node, element, container>
        if (text._text !== next._text) host.setText(text._node, next._text)
        return {
          kind: 'text',
          type: next.type,
          key: next.key,
          _text: next._text,
          _node: text._node,
          _parent: vParent,
        }
      }

      case 'fragment': {
        let currFragment = curr as MountedFragment<node, element, container>
        let mounted: MountedFragment<node, element, container> = {
          kind: 'fragment',
          type: next.type,
          key: next.key,
          _children: noChildren,
          _parent: vParent,
        }
        // A fragment owns no container of its own, so content appended to it
        // has to land before whatever follows the fragment, not before whatever
        // follows the region the fragment sits in. The previous fragment still
        // has its old sibling links, which is what makes this resolvable while
        // the new tree is only half built.
        let childAnchor = nextSiblingAnchor(currFragment) ?? anchor
        mounted._children = diffChildren(
          currFragment._children,
          next._children,
          parent,
          mounted,
          context,
          childAnchor,
          cursor,
        )
        return mounted
      }

      case 'host': {
        return diffHost(curr as Host, next, parent, vParent, context)
      }

      case 'frame': {
        let currFrame = curr as MountedFrame<node, element, container>
        // The host owns the frame's content and its range: it decides whether
        // the update reuses the current range or replaces it in place.
        currFrame._frame.update(next.props)
        return {
          kind: 'frame',
          type: next.type,
          key: next.key,
          props: next.props,
          _frame: currFrame._frame,
          _parent: vParent,
        }
      }

      case 'component': {
        return diffComponent(
          curr as MountedComponent<node, element, container>,
          next,
          parent,
          vParent,
          context,
          anchor,
          cursor,
        )
      }
    }
  }

  function diffHost(
    currHost: Host,
    next: HostNode,
    parent: HostParent,
    vParent: Parent,
    context: Context,
    reclaimed = false,
  ): Host {
    let hostNode = currHost._node
    let previous = currHost._mixedProps
    let resolved = resolveHostProps(next.type, next.props, vParent, context, currHost._mixState)
    let mounted: Host = {
      kind: 'host',
      type: next.type,
      key: next.key,
      props: next.props,
      _children: noChildren,
      _node: hostNode,
      _parent: vParent,
      _mixedProps: resolved.props,
      _mixState: resolved.state,
      _directEventDescriptors: resolved.directEvents,
      _directEventState: currHost._directEventState,
      _shared: currHost._shared,
    }

    let childrenCommitted = false
    try {
      // Scheduled updates already dispatch these phases for the affected bindings.
      let inlineLifecycle =
        (resolved.state?.runners.length ?? 0) > 0 && !isInUpdateScope(hostNode, context)
      if (inlineLifecycle) dispatchMixinBeforeUpdate(resolved.state)

      let previousHtml = rawHtml(previous)
      let html = rawHtml(resolved.props)
      if (html !== undefined) {
        if (previousHtml === undefined) {
          let children = currHost._children
          for (let index = 0; index < children.length; index++) {
            releaseNode(children[index], context)
          }
          applyRawHtml(mounted, html)
        } else if (previousHtml !== html) {
          applyRawHtml(mounted, html)
        }
      } else {
        // Clear raw content before mounting the tree's own children.
        if (previousHtml !== undefined) applyRawHtml(mounted, '')
        mounted._children = diffChildren(
          previousHtml === undefined ? currHost._children : null,
          next._children,
          hostNode,
          mounted,
          context,
          null,
          undefined,
        )
      }
      childrenCommitted = true

      host.patchProps(hostNode, previous, resolved.props)
      syncHostEvents(mounted)
      host.finalizeElement?.(hostNode, resolved.props)
      bindHostMixins(mounted, parent, context, reclaimed ? { dispatchReclaimed: true } : undefined)
      if (inlineLifecycle) {
        context.scheduler.enqueueCommitPhase([() => dispatchMixinCommit(resolved.state)])
      }
      return mounted
    } catch (error) {
      // A host operation can fail after the children pass has succeeded. Keep
      // those children reachable through the previous tree, just as a failed
      // children pass adopts its completed siblings.
      if (childrenCommitted) {
        currHost._children = mounted._children
        for (let child of mounted._children) child._parent = currHost
      }
      currHost._mixState = mounted._mixState
      currHost._directEventState = mounted._directEventState
      throw error
    }
  }

  // A retained element stayed where it was, so it only moves when it is not
  // already the node its anchor follows. Skipping the host mutation is what
  // keeps a reversed exit animation from restarting on reclaim.
  function placeReclaimed(retained: Host, parent: HostParent, anchor: node | null): void {
    if (retained._shared) return
    let hostNode = retained._node
    if (host.parentNode(hostNode) === parent && host.nextSibling(hostNode) === anchor) return
    host.insert(hostNode, parent, anchor)
  }

  function replace(
    curr: Mounted,
    next: VNodeInput,
    parent: HostParent,
    vParent: Parent,
    context: Context,
    anchor: node | null,
  ): Mounted {
    let first = findFirstAnchor(curr)

    if (first !== null && host.parentNode(first) === parent) {
      // Hold the exact position while the old node is torn down, so the
      // replacement cannot drift to the end of the parent.
      let placeholder = host.createComment('rmx:replace', parent)
      host.insert(placeholder, parent, first)
      try {
        removeNode(curr, context)
        return mount(next, parent, vParent, context, placeholder, undefined)
      } finally {
        host.remove(placeholder)
      }
    }

    let fallbackAnchor = nextSiblingAnchor(curr) ?? anchor
    removeNode(curr, context)
    return mount(next, parent, vParent, context, fallbackAnchor, undefined)
  }

  function diffChildren(
    curr: Mounted[] | null,
    next: VNodeInput[],
    parent: HostParent,
    vParent: Parent,
    context: Context,
    anchor: node | null,
    cursor: Cursor,
  ): Mounted[] {
    let keyed = hasKeyedChildren(next)

    if (curr === null) {
      if (keyed) warnDuplicateKeys(next)
      return mountChildren(next, parent, vParent, context, anchor, cursor)
    }

    let clearChildren = host.clearChildren
    if (clearChildren && next.length === 0 && anchor === null && canClearChildren(vParent, curr)) {
      for (let index = 0; index < curr.length; index++) releaseNode(curr[index], context)
      clearChildren(parent)
      return noChildren
    }

    if (keyed) return diffKeyedChildren(curr, next, parent, vParent, context, anchor, cursor)

    // The input array is built fresh for every render, so it doubles as the
    // committed array rather than allocating a parallel one.
    let committed: Array<VNodeInput | Mounted> = next
    let index = 0

    try {
      for (; index < next.length; index++) {
        committed[index] = diff(
          index < curr.length ? curr[index] : null,
          next[index],
          parent,
          vParent,
          context,
          anchor,
          cursor,
        )
      }
    } catch (error) {
      adoptCommittedChildren(committed, index, curr, null, context)
      throw error
    }

    for (let extra = next.length; extra < curr.length; extra++) {
      removeNode(curr[extra], context)
    }

    return committed as Mounted[]
  }

  // A children pass that throws discards the parent wrapper it was building, so
  // the children it already committed are owned by nothing: their components
  // schedule updates against a wrapper the live tree cannot reach, their
  // anchors resolve against a wrapper with no children, and an unmount walking
  // the live tree never reaches the nodes they replaced. The live parent takes
  // them over instead: each child fills the slot of the node it diffed — the
  // slot the live parent still points at — even when it replaced or remounted
  // that node. A child that had no node to diff was mounted from scratch and is
  // removed, because no slot can hold it: nothing in the live tree would ever
  // remove its nodes or abort its components.
  function adoptCommittedChildren(
    committed: Array<VNodeInput | Mounted>,
    count: number,
    curr: Mounted[],
    matches: readonly number[] | null,
    context: Context,
  ): void {
    for (let index = 0; index < count; index++) {
      let child = committed[index] as Mounted
      let oldIndex = matches === null ? index : matches[index]
      if (oldIndex < 0 || oldIndex >= curr.length) {
        removeNode(child, context)
        continue
      }
      child._parent = curr[oldIndex]._parent
      curr[oldIndex] = child
    }
  }

  function mountChildren(
    next: VNodeInput[],
    parent: HostParent,
    vParent: Parent,
    context: Context,
    anchor: node | null,
    cursor: Cursor,
  ): Mounted[] {
    let committed: Array<VNodeInput | Mounted> = next
    let index = 0

    try {
      for (; index < next.length; index++) {
        committed[index] = mount(next[index], parent, vParent, context, anchor, cursor)
      }
    } catch (error) {
      // Siblings that did mount are already live: remove them so their
      // components abort and their pending update() promises settle.
      for (let mountedIndex = 0; mountedIndex < index; mountedIndex++) {
        removeNode(committed[mountedIndex] as Mounted, context)
      }
      throw error
    }

    return committed as Mounted[]
  }

  function diffKeyedChildren(
    curr: Mounted[],
    next: VNodeInput[],
    parent: HostParent,
    vParent: Parent,
    context: Context,
    anchor: node | null,
    cursor: Cursor,
  ): Mounted[] {
    let matches = matchKeyedChildren(curr, next)
    let analysis = analyzeKeyedChildMatches(curr.length, matches)

    if (analysis.hasRemovals) {
      let matched = new Uint8Array(curr.length)
      for (let index = 0; index < matches.length; index++) {
        let oldIndex = matches[index]
        if (oldIndex >= 0) matched[oldIndex] = 1
      }
      for (let oldIndex = 0; oldIndex < curr.length; oldIndex++) {
        if (matched[oldIndex] === 0) removeNode(curr[oldIndex], context)
      }
    }

    let committed: Array<VNodeInput | Mounted> = next
    let index = 0

    try {
      for (; index < next.length; index++) {
        let oldIndex = matches[index]
        committed[index] = diff(
          oldIndex >= 0 ? curr[oldIndex] : null,
          next[index],
          parent,
          vParent,
          context,
          anchor,
          cursor,
        )
      }
    } catch (error) {
      adoptCommittedChildren(committed, index, curr, matches, context)
      throw error
    }
    let children = committed as Mounted[]

    if (analysis.canSkipPlacement) return children

    // Nodes on the longest increasing run of matches are already ordered
    // correctly; every other node moves once, walking backwards so the anchor
    // is always a node whose final position is settled.
    let stableIndexes = lisMatches(matches)
    let stableCursor = stableIndexes.length - 1
    let placementAnchor = anchor

    for (let position = next.length - 1; position >= 0; position--) {
      let child = children[position]

      if (stableIndexes[stableCursor] === position) {
        stableCursor--
      } else {
        place(child, parent, placementAnchor)
      }

      placementAnchor = findFirstAnchor(child) ?? placementAnchor
    }

    return children
  }

  // Bulk clearing takes one host call instead of one per child, but it empties
  // the whole container: only an element this engine created and fully owns
  // qualifies. A root container and a shared element can both hold host-owned
  // children, a fragment only covers part of its parent, and a retained,
  // mixin-bound, or frame child needs its own removal path.
  function canClearChildren(vParent: Parent, children: Mounted[]): boolean {
    if (vParent.kind !== 'host' || vParent._shared) return false
    return canClearNodes(children)
  }

  function canClearNodes(children: Mounted[]): boolean {
    for (let index = 0; index < children.length; index++) {
      if (!canClearNode(children[index])) return false
    }
    return true
  }

  function canClearNode(target: Mounted): boolean {
    switch (target.kind) {
      case 'empty':
      case 'text':
        return true
      case 'host':
        if (target._mixState || target._persistence || target._shared) return false
        return canClearNodes(target._children)
      case 'fragment':
        return canClearNodes(target._children)
      case 'component':
        return target._content === null || canClearNode(target._content)
      case 'frame':
        return false
    }
  }

  function place(target: Mounted, parent: HostParent, anchor: node | null): void {
    let first = findFirstAnchor(target)
    if (first === null || host.parentNode(first) !== parent) return
    if (first === anchor) return

    let last = findLastAnchor(target)
    if (last === null) return
    if (anchor !== null && rangeContains(first, last, anchor)) return

    // Fragments, components, and frames can cover several sibling nodes, so the
    // whole contiguous range moves as one.
    let current: node | null = first
    while (current !== null) {
      let following: node | null = current === last ? null : host.nextSibling(current)
      host.insert(current, parent, anchor)
      if (current === last) return
      current = following
    }
  }

  function rangeContains(first: node, last: node, target: node): boolean {
    let current: node | null = first
    while (current !== null) {
      if (current === target) return true
      if (current === last) return false
      current = host.nextSibling(current)
    }
    return false
  }

  function diffComponent(
    curr: MountedComponent<node, element, container> | null,
    next: ComponentNode,
    parent: HostParent,
    vParent: Parent,
    context: Context,
    anchor: node | null,
    cursor: Cursor,
  ): MountedComponent<node, element, container> {
    let handle = curr === null ? createHandle(next.type, vParent, context) : curr._handle
    let mounted: MountedComponent<node, element, container> = {
      kind: 'component',
      type: next.type,
      key: next.key,
      props: next.props,
      _handle: handle,
      _content: null,
      _superseded: false,
      _parent: vParent,
      _context: context,
    }

    if (curr === null) return renderComponent(null, mounted, parent, context, anchor, cursor)

    // An update scheduled against the previous node is now redundant: this
    // render already used the latest props and drained its tasks.
    curr._superseded = true

    try {
      return renderComponent(curr._content, mounted, parent, context, anchor, cursor)
    } catch (error) {
      // The new node never joined the tree, so the previous one is still the
      // live node and has to stay updatable. Leaving it superseded strands the
      // component: its handle still schedules against it, and the scheduler
      // drops a superseded target without rendering or settling it.
      curr._superseded = false
      mounted._superseded = true
      handle.setScheduleUpdate(context.scheduler, curr, parent)
      throw error
    }
  }

  function createHandle(type: ElementFunction, vParent: Parent, context: Context) {
    return createComponent<unknown, HostParent>({
      id: context.nextComponentId(vParent),
      type,
      frame: context.frame,
      getContext: (contextType: ElementFunction) => findContextValue(vParent, contextType),
      getFrameByName: (name: string) => context.getFrameByName(name),
      getTopFrame: () => context.getTopFrame(),
    })
  }

  function renderComponent(
    currContent: Mounted | null,
    target: MountedComponent<node, element, container>,
    parent: HostParent,
    context: Context,
    anchor: node | null,
    cursor: Cursor,
  ): MountedComponent<node, element, container> {
    let handle = target._handle

    if (handle.isRemoved()) {
      // Removed between scheduling and flushing: keep the content reference so
      // an unmount can still reach it, and render nothing.
      target._content = currContent
      return target
    }

    let mounting = currContent === null

    try {
      let [element, tasks] = handle.render(target.props)
      // Queued before the content diff so a failure below still settles the
      // promises this render already took ownership of. Tasks run after the
      // batch commits either way.
      context.scheduler.enqueueTasks(tasks)
      target._content = diff(currContent, toVNode(element), parent, target, context, anchor, cursor)
      handle.setScheduleUpdate(context.scheduler, target, parent)
    } catch (error) {
      if (mounting) {
        // The component never joined the tree, so nothing will ever unmount
        // it: end its lifetime here, which also aborts the signal handed to
        // any task this render queued.
        target._superseded = true
        context.scheduler.enqueueTasks(handle.remove())
      } else {
        // The component stays mounted, but the render an update() awaited did
        // not happen: settle those promises with an aborted signal.
        context.scheduler.enqueueTasks(handle.releasePendingTasks())
      }
      throw error
    }

    return target
  }

  function removeNode(target: Mounted, context: Context): void {
    switch (target.kind) {
      case 'empty': {
        return
      }

      case 'text': {
        host.remove(target._node)
        return
      }

      case 'fragment': {
        let children = target._children
        for (let index = 0; index < children.length; index++) {
          removeNode(children[index], context)
        }
        return
      }

      case 'host': {
        removeHost(target, context)
        return
      }

      case 'frame': {
        // The frame releases its resources; its physical range is the core's
        // to remove, and its boundaries are read after the release so a frame
        // that replaced its own range in place still removes the live one.
        target._frame.dispose()
        removeRange(target._frame.start, target._frame.end)
        return
      }

      case 'component': {
        if (target._content !== null) removeNode(target._content, context)
        target._superseded = true
        context.scheduler.enqueueTasks(target._handle.remove())
        return
      }
    }
  }

  function removeHost(target: Host, context: Context): void {
    let persistence = host.persistence
    if (persistence) {
      // Already waiting on a `persistNode()` teardown: the pending removal owns
      // this element now.
      if (target._persistence) return

      let parent = host.parentNode(target._node)
      if (parent !== null) {
        let retained = retainHostRemoval(persistence, target, parent)
        if (retained) {
          void retained.done
            .catch(() => {})
            .finally(() => {
              if (target._persistence?.token !== retained.token) return
              // The removal lands outside any render, so the root has to be
              // marked dirty for the host to commit it.
              context.markDirty()
              context.scheduler.enqueueWork([
                () => {
                  if (!settleRetainedRemoval(persistence, target, retained.token)) return
                  detachHost(target, context)
                },
              ])
            })
          return
        }
      }
    }

    detachHost(target, context)
  }

  function detachHost(target: Host, context: Context): void {
    let children = target._children

    if (target._shared) {
      // The element outlives this tree, so its rendered children are removed
      // one by one and anything the host put there stays. Listeners have to be
      // detached for real: nothing is going to be garbage collected here.
      for (let index = 0; index < children.length; index++) {
        removeNode(children[index], context)
      }
      teardownMixins(target._mixState)
      let state = target._directEventState
      if (state) {
        teardownDirectEventListeners(requireEventTarget(target), state)
        target._directEventState = undefined
      }
      host.releaseElement?.(target._node, false)
      return
    }

    teardownMixins(target._mixState)
    // The subtree leaves with the element, so descendants only need their
    // lifetimes released; removing each one individually would dominate
    // large teardowns.
    for (let index = 0; index < children.length; index++) {
      releaseNode(children[index], context)
    }
    abandonDirectEventListeners(target._directEventState)
    target._directEventState = undefined
    host.releaseElement?.(target._node, true)
    host.remove(target._node)
  }

  function releaseNode(target: Mounted, context: Context): void {
    switch (target.kind) {
      case 'empty':
      case 'text': {
        return
      }

      case 'fragment': {
        let children = target._children
        for (let index = 0; index < children.length; index++) {
          releaseNode(children[index], context)
        }
        return
      }

      case 'host': {
        // A shared element is not inside the subtree that is going away, so its
        // rendered children have to be removed rather than merely released.
        if (target._shared) {
          detachHost(target, context)
          return
        }

        // Mixins of a discarded descendant still hold runners, scheduler
        // subscriptions, and handler bindings on its event target.
        teardownMixins(target._mixState)
        let children = target._children
        for (let index = 0; index < children.length; index++) {
          releaseNode(children[index], context)
        }
        abandonDirectEventListeners(target._directEventState)
        target._directEventState = undefined
        host.releaseElement?.(target._node, true)
        return
      }

      case 'frame': {
        target._frame.dispose()
        return
      }

      case 'component': {
        if (target._content !== null) releaseNode(target._content, context)
        target._superseded = true
        context.scheduler.enqueueTasks(target._handle.remove())
        return
      }
    }
  }

  function removeRange(start: node, end: node): void {
    let parent = host.parentNode(start)
    if (parent === null) return

    let current: node | null = start
    while (current !== null) {
      let following: node | null = current === end ? null : host.nextSibling(current)
      if (host.parentNode(current) === parent) host.remove(current)
      if (current === end) return
      current = following
    }
  }

  function rawHtml(props: RuntimeHostProps): string | undefined {
    let html = props.innerHTML
    return html == null ? undefined : html
  }

  function applyRawHtml(target: Host, html: string): void {
    let setInnerHTML = host.setInnerHTML
    if (!setInnerHTML) throw new Error(rawHtmlUnsupported(target.type))
    setInnerHTML(target._node, html)
  }

  type ResolvedHostProps = {
    props: RuntimeHostProps
    state?: MixinRuntimeState
    directEvents?: OnMixinDescriptor[]
  }

  function resolveHostProps(
    type: string,
    props: RuntimeHostProps,
    vParent: Parent,
    context: Context,
    state?: MixinRuntimeState,
  ): ResolvedHostProps {
    // An element whose `mix` is only `on(...)` listeners never needs the mixin
    // runtime, which is the difference between a handler binding and a whole
    // mixin lifecycle on the most common interactive elements.
    let directEvents = resolveDirectEventDescriptors(props.mix)
    if (directEvents) {
      if (state) teardownMixins(state)
      return { props, directEvents }
    }

    let resolved = resolveMixedProps({
      hostType: type,
      frame: context.frame,
      scheduler: context.scheduler,
      getContext: (contextType: ElementType | symbol) =>
        typeof contextType === 'function'
          ? findContextValue(vParent, contextType as ElementFunction)
          : undefined,
      props,
      state,
    })
    // Mixins compose host props, so what they return is a host prop bag: the
    // renderer-owned `mix` and `children` fields ride along and hosts ignore
    // them, which keeps this path free of a per-render copy.
    return { props: resolved.props as RuntimeHostProps, state: resolved.state }
  }

  function requireEventTarget(target: Host): EventTarget {
    let getEventTarget = host.getEventTarget
    if (!getEventTarget) throw new Error(mixinsUnsupported(target.type))
    return getEventTarget(target._node)
  }

  function syncHostEvents(target: Host): void {
    let descriptors = target._directEventDescriptors
    let state = target._directEventState
    // Nothing bound and nothing to bind: an element without listeners must not
    // force the host to produce an event target.
    if (state === undefined && (descriptors === undefined || descriptors.length === 0)) return
    target._directEventState = syncDirectEventListeners(
      requireEventTarget(target),
      descriptors,
      state,
    )
  }

  function bindHostMixins(
    target: Host,
    parent: HostParent,
    context: Context,
    options?: { dispatchReclaimed?: boolean },
  ): void {
    let state = target._mixState
    if (!state) return

    let binding: MixinRuntimeBinding<Host, EventTarget, HostParent> = {
      node: requireEventTarget(target),
      parent,
      key: target.key,
      target,
      frame: context.frame,
      scheduler: context.scheduler,
      enqueueUpdate(done) {
        enqueueHostMixinUpdate(state, context, done)
      },
      contains(container) {
        return containsNode(container, target._node)
      },
    }
    bindMixinRuntime(state, binding, options)
  }

  // `handle.update()` from a mixin: re-resolve this element's props inside the
  // current batch and patch what changed, without re-rendering the component
  // that owns the element.
  function enqueueHostMixinUpdate(
    state: MixinRuntimeState,
    context: Context,
    done: (signal: AbortSignal) => void,
  ): void {
    // Nothing in this batch is a render, so the root would otherwise have no
    // reason to commit the props this update patches.
    context.markDirty()
    context.scheduler.enqueueWork([
      () => {
        if (state.aborted || !state.binding) {
          done(getMixinRuntimeSignal(state))
          return
        }

        // Each render rebinds the runtime to the node it just committed, so the
        // binding — not this closure — knows which node is live.
        let target = state.binding.target as Host
        // Work tasks run inside the update pass, so the scheduler still
        // dispatches the phases for every binding it re-rendered: dispatching
        // here as well would run this element's mixin lifecycles twice, and a
        // second `beforeUpdate` would overwrite what the first one captured.
        let inlineLifecycle = !isInUpdateScope(target._node, context)
        try {
          if (inlineLifecycle) dispatchMixinBeforeUpdate(state)
          let previous = target._mixedProps
          let resolved = resolveHostProps(target.type, target.props, target._parent, context, state)
          target._mixedProps = resolved.props
          target._mixState = resolved.state
          target._directEventDescriptors = resolved.directEvents
          host.patchProps(target._node, previous, resolved.props)
          syncHostEvents(target)
          host.finalizeElement?.(target._node, resolved.props)
          if (inlineLifecycle) {
            // This runs in the mutation phase, and commit lifecycles observe
            // host state the batch has restored: queue it like a render does.
            context.scheduler.enqueueCommitPhase([() => dispatchMixinCommit(resolved.state)])
          }
        } finally {
          done(getMixinRuntimeSignal(state))
        }
      },
    ])
  }

  function containsNode(parent: unknown, target: node): boolean {
    let current: node | element | container | null = target
    while (current !== null) {
      if (current === parent) return true
      current = host.parentNode(current)
    }
    return false
  }

  function isInUpdateScope(target: node, context: Context): boolean {
    let parents = context.scheduler.updateParents()
    for (let index = 0; index < parents.length; index++) {
      if (containsNode(parents[index], target)) return true
    }
    return false
  }

  // The renderer only owns the nodes it created, so the end of its range at the
  // root is its insertion boundary, or whatever currently follows the last node
  // it manages. Resolved on demand rather than marked, so host-owned children
  // appended later still stay after the managed range.
  function rootTailAnchor(root: MountedRoot<node, element, container>): node | null {
    if (root._anchor != null) return root._anchor

    let children = root._children
    for (let index = children.length - 1; index >= 0; index--) {
      let last = findLastAnchor(children[index], isAttached)
      if (last !== null) return host.nextSibling(last)
    }
    return null
  }

  function nextSiblingAnchor(target: Mounted): node | null {
    return findNextSiblingAnchor(target, rootTailAnchor, isAttached)
  }

  function isAttached(target: node): boolean {
    return host.parentNode(target) !== null
  }

  return {
    renderRoot(curr, input, root, context) {
      return diff(
        curr,
        toVNode(input),
        root._node,
        root,
        context,
        root._anchor ?? null,
        context.hydration,
      )
    },

    updateComponent(target, updateParent, context) {
      if (target._superseded) return
      // Every mutation this render makes has to reach the host, including the
      // partial ones left behind when it throws.
      context.markDirty()
      // Resolved from the tree on every update: a cached anchor would be stale
      // as soon as a sibling moved.
      renderComponent(
        target._content,
        target,
        updateParent,
        context,
        nextSiblingAnchor(target),
        undefined,
      )
    },

    releaseComponent(target, context) {
      if (target._superseded) return
      context.scheduler.enqueueTasks(target._handle.releasePendingTasks())
    },

    removeNode,
  }
}
