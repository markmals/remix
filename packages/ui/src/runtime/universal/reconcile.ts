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
import type { ElementProps, ElementType, RemixNode } from '../jsx.ts'
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
import { toVNode } from '../to-vnode.ts'
import type { ComponentNode, RuntimeHostProps, VNodeInput } from '../vnode.ts'
import type { RendererHost } from './host.ts'
import type { UpdateScheduler } from './scheduler.ts'
import {
  findContextValue,
  findFirstAnchor,
  findLastAnchor,
  findNextSiblingAnchor,
  type MountedComponent,
  type MountedFragment,
  type MountedHost,
  type MountedParent,
  type MountedRoot,
  type MountedText,
  type MountedVNode,
} from './vnode.ts'

/**
 * Message used wherever frame support is required but unavailable.
 *
 * Frames need document navigation, streaming HTML, and DOM range markers, so a
 * universal host rejects them instead of rendering an empty region.
 */
export const FRAMES_UNSUPPORTED =
  'Frames are not supported by this renderer host; <Frame /> requires the DOM runtime'

/**
 * Builds the message for a `mix` prop on a host that cannot bind mixins.
 *
 * Mixins observe an event target, so a host has to expose one through
 * {@link RendererHost.getEventTarget} before the shared mixin runtime can bind
 * to its elements.
 *
 * @param type Host type the `mix` prop was used on.
 * @returns The error message.
 */
function mixinsUnsupported(type: string): string {
  return `Mixins are not supported by this renderer host; remove mix from <${type} /> or implement host.getEventTarget`
}

/**
 * Per-root state the reconciler needs.
 */
export interface UniversalContext<node extends object, element extends node> {
  /** Frame handle exposed to components. Rejects every frame operation. */
  readonly frame: FrameHandle
  /** Scheduler that owns update batching for this root. */
  readonly scheduler: UpdateScheduler<MountedComponent<node, element>, element>
  /**
   * Allocates the next component instance id.
   *
   * @returns An id unique within the renderer.
   */
  nextComponentId(): string
}

/**
 * Reconciler bound to one host.
 */
export interface UniversalReconciler<node extends object, element extends node> {
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
    curr: MountedVNode<node, element> | null,
    input: RemixNode,
    root: MountedRoot<node, element>,
    context: UniversalContext<node, element>,
  ): MountedVNode<node, element>

  /**
   * Re-renders one scheduled component in place.
   *
   * @param target Component node scheduled for an update.
   * @param updateParent Element the component renders into.
   * @param context Per-root state.
   */
  updateComponent(
    target: MountedComponent<node, element>,
    updateParent: element,
    context: UniversalContext<node, element>,
  ): void

  /**
   * Settles work waiting on an update the scheduler will not run.
   *
   * @param target Component node whose scheduled update was abandoned.
   * @param context Per-root state.
   */
  releaseComponent(
    target: MountedComponent<node, element>,
    context: UniversalContext<node, element>,
  ): void

  /**
   * Removes a mounted node from the host and releases its lifetimes.
   *
   * @param target Node to remove.
   * @param context Per-root state.
   */
  removeNode(target: MountedVNode<node, element>, context: UniversalContext<node, element>): void
}

/**
 * Creates the reconciler for a renderer host.
 *
 * Reconciliation is host-agnostic: it resolves identity, ordering, and
 * lifetimes, and expresses every mutation through {@link RendererHost}. It
 * shares the component runtime and keyed matching with the DOM reconciler, so
 * component semantics (stable props, setup, context, tasks, abort signals) are
 * identical across hosts.
 *
 * @param host Host operations to mutate through.
 * @returns A reconciler bound to the host.
 */
export function createReconciler<node extends object, element extends node>(
  host: RendererHost<node, element>,
): UniversalReconciler<node, element> {
  type Mounted = MountedVNode<node, element>
  type Parent = MountedParent<node, element>
  type Context = UniversalContext<node, element>

  // Placeholder for `_children` between creating a node and reconciling its
  // children, which need the node as their parent. Never mutated.
  let noChildren: Mounted[] = []

  function mount(
    next: VNodeInput,
    parent: element,
    vParent: Parent,
    context: Context,
    anchor: node | null,
  ): Mounted {
    if (next.kind === 'frame') throw new Error(FRAMES_UNSUPPORTED)

    switch (next.kind) {
      case 'empty': {
        return { kind: 'empty', type: next.type, key: next.key, _parent: vParent }
      }

      case 'text': {
        let textNode = host.createText(next._text)
        host.insert(textNode, parent, anchor)
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
        let mounted: MountedFragment<node, element> = {
          kind: 'fragment',
          type: next.type,
          key: next.key,
          _children: noChildren,
          _parent: vParent,
        }
        mounted._children = diffChildren(null, next._children, parent, mounted, context, anchor)
        return mounted
      }

      case 'host': {
        assertSupportedHostProps(next.type, next.props)
        let resolved = resolveHostProps(next.type, next.props, vParent, context)
        let mounted: MountedHost<node, element> | undefined
        try {
          let hostNode = host.createElement(next.type, resolved.props)
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
          }
          mounted._children = diffChildren(null, next._children, hostNode, mounted, context, null)
          host.insert(hostNode, parent, anchor)
          bindHostMixins(mounted, parent, context)
          return mounted
        } catch (error) {
          if (mounted) removeNode(mounted, context)
          else teardownMixins(resolved.state)
          throw error
        }
      }

      case 'component': {
        return diffComponent(null, next, parent, vParent, context, anchor)
      }
    }
  }

  function diff(
    curr: Mounted | null,
    next: VNodeInput,
    parent: element,
    vParent: Parent,
    context: Context,
    anchor: node | null,
  ): Mounted {
    if (curr === null) return mount(next, parent, vParent, context, anchor)
    if (next.kind === 'frame') throw new Error(FRAMES_UNSUPPORTED)

    if (curr.kind !== next.kind || curr.type !== next.type) {
      return replace(curr, next, parent, vParent, context, anchor)
    }

    // Matching kind and type make the mounted node's shape known, which the
    // union discriminants alone cannot express for two parallel unions.
    switch (next.kind) {
      case 'empty': {
        return { kind: 'empty', type: next.type, key: next.key, _parent: vParent }
      }

      case 'text': {
        let text = curr as MountedText<node, element>
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
        let currFragment = curr as MountedFragment<node, element>
        let mounted: MountedFragment<node, element> = {
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
        )
        return mounted
      }

      case 'host': {
        let currHost = curr as MountedHost<node, element>
        assertSupportedHostProps(next.type, next.props)
        let resolved = resolveHostProps(next.type, next.props, vParent, context, currHost._mixState)
        let mounted: MountedHost<node, element> = {
          kind: 'host',
          type: next.type,
          key: next.key,
          props: next.props,
          _children: noChildren,
          _node: currHost._node,
          _parent: vParent,
          _mixedProps: resolved.props,
          _mixState: resolved.state,
        }
        // Inside a scheduled update the scheduler dispatches the phases for
        // every binding it re-rendered, so dispatching here as well would run
        // mixin lifecycles twice for this element.
        let inlineLifecycle =
          (resolved.state?.runners.length ?? 0) > 0 && !isInUpdateScope(currHost._node, context)
        if (inlineLifecycle) dispatchMixinBeforeUpdate(resolved.state)
        mounted._children = diffChildren(
          currHost._children,
          next._children,
          currHost._node,
          mounted,
          context,
          null,
        )
        patchHostProps(currHost._node, currHost._mixedProps, resolved.props)
        // Rebinding refreshes the binding's target, so mixin updates resolve
        // against the node just committed instead of the superseded one.
        bindHostMixins(mounted, parent, context)
        if (inlineLifecycle) {
          context.scheduler.enqueueCommitPhase([() => dispatchMixinCommit(resolved.state)])
        }
        return mounted
      }

      case 'component': {
        return diffComponent(
          curr as MountedComponent<node, element>,
          next,
          parent,
          vParent,
          context,
          anchor,
        )
      }
    }
  }

  function replace(
    curr: Mounted,
    next: VNodeInput,
    parent: element,
    vParent: Parent,
    context: Context,
    anchor: node | null,
  ): Mounted {
    let first = findFirstAnchor(curr)

    if (first !== null && host.parentNode(first) === parent) {
      // Hold the exact position while the old node is torn down, so the
      // replacement cannot drift to the end of the parent.
      let placeholder = host.createComment('rmx:replace')
      host.insert(placeholder, parent, first)
      try {
        removeNode(curr, context)
        return mount(next, parent, vParent, context, placeholder)
      } finally {
        host.remove(placeholder)
      }
    }

    let fallbackAnchor = nextSiblingAnchor(curr) ?? anchor
    removeNode(curr, context)
    return mount(next, parent, vParent, context, fallbackAnchor)
  }

  function diffChildren(
    curr: Mounted[] | null,
    next: VNodeInput[],
    parent: element,
    vParent: Parent,
    context: Context,
    anchor: node | null,
  ): Mounted[] {
    let keyed = hasKeyedChildren(next)

    if (curr === null) {
      if (keyed) warnDuplicateKeys(next)
      return mountChildren(next, parent, vParent, context, anchor)
    }

    if (keyed) return diffKeyedChildren(curr, next, parent, vParent, context, anchor)

    // The input array is built fresh for every render, so it doubles as the
    // committed array rather than allocating a parallel one.
    let committed: Array<VNodeInput | Mounted> = next
    // Nodes this pass mounted from scratch, which the previous tree does not
    // reference: if a later child throws, nothing else can ever remove them or
    // abort their components. Only allocated when a child actually mounts.
    let mountedFresh: Mounted[] | null = null

    for (let index = 0; index < next.length; index++) {
      let currentNode = index < curr.length ? curr[index] : null
      let input = next[index]
      let mounts = isFreshMount(currentNode, input)
      try {
        let child = diff(currentNode, input, parent, vParent, context, anchor)
        committed[index] = child
        if (mounts) (mountedFresh ??= []).push(child)
      } catch (error) {
        if (mountedFresh !== null) {
          for (let freshIndex = 0; freshIndex < mountedFresh.length; freshIndex++) {
            removeNode(mountedFresh[freshIndex], context)
          }
        }
        throw error
      }
    }

    for (let index = next.length; index < curr.length; index++) {
      removeNode(curr[index], context)
    }

    return committed as Mounted[]
  }

  // Mirrors the identity check in `diff`: no previous node, or a changed kind
  // or type, means this child mounts a new node instead of updating one.
  function isFreshMount(curr: Mounted | null, next: VNodeInput): boolean {
    if (curr === null) return true
    return curr.kind !== next.kind || curr.type !== next.type
  }

  function mountChildren(
    next: VNodeInput[],
    parent: element,
    vParent: Parent,
    context: Context,
    anchor: node | null,
  ): Mounted[] {
    let committed: Array<VNodeInput | Mounted> = next
    let index = 0

    try {
      for (; index < next.length; index++) {
        committed[index] = mount(next[index], parent, vParent, context, anchor)
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
    parent: element,
    vParent: Parent,
    context: Context,
    anchor: node | null,
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
    let mountedFresh: Mounted[] | null = null

    for (let index = 0; index < next.length; index++) {
      let oldIndex = matches[index]
      let currentNode = oldIndex >= 0 ? curr[oldIndex] : null
      let input = next[index]
      let mounts = isFreshMount(currentNode, input)
      try {
        let child = diff(currentNode, input, parent, vParent, context, anchor)
        committed[index] = child
        if (mounts) (mountedFresh ??= []).push(child)
      } catch (error) {
        // Fresh mounts are not referenced by the previous tree, so they would
        // stay in the host tree with live components after this unwinds.
        if (mountedFresh !== null) {
          for (let freshIndex = 0; freshIndex < mountedFresh.length; freshIndex++) {
            removeNode(mountedFresh[freshIndex], context)
          }
        }
        throw error
      }
    }
    let children = committed as Mounted[]

    if (analysis.canSkipPlacement) return children

    // Nodes on the longest increasing run of matches are already ordered
    // correctly; every other node moves once, walking backwards so the anchor
    // is always a node whose final position is settled.
    let stableIndexes = lisMatches(matches)
    let stableCursor = stableIndexes.length - 1
    let placementAnchor = anchor

    for (let index = next.length - 1; index >= 0; index--) {
      let child = children[index]

      if (stableIndexes[stableCursor] === index) {
        stableCursor--
      } else {
        place(child, parent, placementAnchor)
      }

      placementAnchor = findFirstAnchor(child) ?? placementAnchor
    }

    return children
  }

  function place(target: Mounted, parent: element, anchor: node | null): void {
    let first = findFirstAnchor(target)
    if (first === null || host.parentNode(first) !== parent) return
    if (first === anchor) return

    let last = findLastAnchor(target)
    if (last === null) return
    if (anchor !== null && rangeContains(first, last, anchor)) return

    // Fragments and components can cover several sibling nodes, so the whole
    // contiguous range moves as one.
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
    curr: MountedComponent<node, element> | null,
    next: ComponentNode,
    parent: element,
    vParent: Parent,
    context: Context,
    anchor: node | null,
  ): MountedComponent<node, element> {
    let handle = curr === null ? createHandle(next.type, vParent, context) : curr._handle
    let mounted: MountedComponent<node, element> = {
      kind: 'component',
      type: next.type,
      key: next.key,
      props: next.props,
      _handle: handle,
      _content: null,
      _superseded: false,
      _parent: vParent,
    }

    if (curr === null) return renderComponent(null, mounted, parent, context, anchor)

    // An update scheduled against the previous node is now redundant: this
    // render already used the latest props and drained its tasks.
    curr._superseded = true

    try {
      return renderComponent(curr._content, mounted, parent, context, anchor)
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
    return createComponent<unknown, element>({
      id: context.nextComponentId(),
      type,
      frame: context.frame,
      getContext: (contextType: ElementFunction) => findContextValue(vParent, contextType),
      getFrameByName: () => undefined,
      getTopFrame: () => context.frame,
    })
  }

  function renderComponent(
    currContent: Mounted | null,
    target: MountedComponent<node, element>,
    parent: element,
    context: Context,
    anchor: node | null,
  ): MountedComponent<node, element> {
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
      target._content = diff(currContent, toVNode(element), parent, target, context, anchor)
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
        teardownMixins(target._mixState)
        let children = target._children
        // The subtree leaves with the element, so descendants only need their
        // lifetimes released; removing each one individually would dominate
        // large teardowns.
        for (let index = 0; index < children.length; index++) {
          releaseNode(children[index], context)
        }
        host.remove(target._node)
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
        // Mixins of a discarded descendant still hold runners, scheduler
        // subscriptions, and handler bindings on its event target.
        teardownMixins(target._mixState)
        let children = target._children
        for (let index = 0; index < children.length; index++) {
          releaseNode(children[index], context)
        }
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

  function assertSupportedHostProps(type: string, props: RuntimeHostProps): void {
    if (props.innerHTML !== undefined) {
      throw new Error(
        `innerHTML is not supported by this renderer host; remove innerHTML from <${type} />`,
      )
    }
  }

  function resolveHostProps(
    type: string,
    props: RuntimeHostProps,
    vParent: Parent,
    context: Context,
    state?: MixinRuntimeState,
  ): { props: RuntimeHostProps; state?: MixinRuntimeState } {
    if (props.mix === undefined && state === undefined) return { props }
    if (!host.getEventTarget) throw new Error(mixinsUnsupported(type))

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
    // `mix` is consumed here: it is renderer state, never a host prop.
    return { props: withoutMix(resolved.props), state: resolved.state }
  }

  function withoutMix(props: ElementProps): RuntimeHostProps {
    if (!('mix' in props)) return props as RuntimeHostProps
    let output = { ...props }
    delete output.mix
    return output as RuntimeHostProps
  }

  function bindHostMixins(
    target: MountedHost<node, element>,
    parent: element,
    context: Context,
  ): void {
    let state = target._mixState
    if (!state) return
    let getEventTarget = host.getEventTarget
    if (!getEventTarget) throw new Error(mixinsUnsupported(target.type))

    let binding: MixinRuntimeBinding<MountedHost<node, element>, EventTarget, element> = {
      node: getEventTarget(target._node),
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
    bindMixinRuntime(state, binding)
  }

  // `handle.update()` from a mixin: re-resolve this element's props inside the
  // current batch and patch what changed, without re-rendering the component
  // that owns the element.
  function enqueueHostMixinUpdate(
    state: MixinRuntimeState,
    context: Context,
    done: (signal: AbortSignal) => void,
  ): void {
    context.scheduler.enqueueWork([
      () => {
        if (state.aborted || !state.binding) {
          done(getMixinRuntimeSignal(state))
          return
        }

        let target = state.binding.target as MountedHost<node, element>
        try {
          dispatchMixinBeforeUpdate(state)
          let previous = target._mixedProps
          let resolved = resolveHostProps(target.type, target.props, target._parent, context, state)
          target._mixedProps = resolved.props
          target._mixState = resolved.state
          patchHostProps(target._node, previous, resolved.props)
          dispatchMixinCommit(state)
        } finally {
          done(getMixinRuntimeSignal(state))
        }
      },
    ])
  }

  function containsNode(container: unknown, target: node): boolean {
    let current: node | null = target
    while (current !== null) {
      if (current === container) return true
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
  // root is whatever currently follows the last node it manages. Resolved on
  // demand rather than marked, so host-owned children appended later still stay
  // after the managed range.
  function rootTailAnchor(root: MountedRoot<node, element>): node | null {
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

  function isAttached(node: node): boolean {
    return host.parentNode(node) !== null
  }

  function patchHostProps(
    target: element,
    previous: RuntimeHostProps,
    next: RuntimeHostProps,
  ): void {
    for (let name in previous) {
      if (name === 'children') continue
      if (!(name in next)) host.patchProp(target, name, previous[name], undefined)
    }

    for (let name in next) {
      if (name === 'children') continue
      let previousValue = previous[name]
      let nextValue = next[name]
      if (previousValue !== nextValue) host.patchProp(target, name, previousValue, nextValue)
    }
  }

  return {
    renderRoot(curr, input, root, context) {
      return diff(curr, toVNode(input), root._node, root, context, null)
    },

    updateComponent(target, updateParent, context) {
      if (target._superseded) return
      // Resolved from the tree on every update: a cached anchor would be stale
      // as soon as a sibling moved.
      renderComponent(target._content, target, updateParent, context, nextSiblingAnchor(target))
    },

    releaseComponent(target, context) {
      if (target._superseded) return
      context.scheduler.enqueueTasks(target._handle.releasePendingTasks())
    },

    removeNode,
  }
}
