import type { FrameHandle } from './component.ts'
import { createFrameHandle } from './component.ts'
import { defaultStyleManager, resetStyleState } from './diff-props.ts'
import { createDomHost } from './dom-renderer/host.ts'
import {
  createComponentErrorEvent,
  getComponentError,
  type ComponentErrorEvent,
} from './error-event.ts'
import { createFrameRuntime, isFrameRuntime, type ResolveFrame } from './frame.ts'
import { invariant } from './invariant.ts'
import type { RemixNode } from './jsx.ts'
import { componentStalenessCheck, registerRoot, unregisterRoot } from './refresh.ts'
import { createScheduler, type Scheduler } from './scheduler.ts'
import { TypedEventTarget } from './typed-event-target.ts'
import { createRenderer, type RendererHydrationCursor } from '../renderer.ts'
import type { StyleManager } from '../style/index.ts'

/**
 * Events emitted by virtual roots.
 */
export type VirtualRootEventMap = {
  error: ComponentErrorEvent
}

/**
 * Root controller returned by {@link createRoot} and {@link createRangeRoot}.
 */
export type VirtualRoot = TypedEventTarget<VirtualRootEventMap> & {
  render: (element: RemixNode) => void
  reconcile: () => void
  dispose: () => void
  flush: () => void
}

/**
 * Options for creating a virtual DOM root with {@link createRoot} or {@link createRangeRoot}.
 */
export type VirtualRootOptions = {
  frame?: FrameHandle
  scheduler?: Scheduler
  styleManager?: StyleManager
  frameInit?: {
    src?: string
    resolveFrame: ResolveFrame
    loadModule?: (moduleUrl: string, exportName: string) => Promise<Function> | Function
  }
}

export { createScheduler, type Scheduler }
export { resetStyleState }

/**
 * Everything a virtual root needs that differs between a container root and a
 * comment-bounded range root.
 */
type VirtualRootTarget = {
  /** Parent the tree is mounted into. */
  container: ParentNode
  /** Node the tree is inserted before, or `null` to append to the container. */
  before: Node | null
  /** Style manager the root and its host share. */
  styles: StyleManager
  /** Server-rendered content to adopt on the first render. */
  hydration: RendererHydrationCursor<Node> | undefined
  /** Component id the server assigned to this root's child component. */
  componentId: string | undefined
  options: VirtualRootOptions
}

function getHydrationComponentIdFromRangeStart(start: Node): string | undefined {
  if (!(start instanceof Comment)) return undefined
  let marker = start.data.trim()
  if (!marker.startsWith('rmx:h:')) return undefined
  let id = marker.slice('rmx:h:'.length)
  return id.length > 0 ? id : undefined
}

/**
 * Creates a virtual root bounded by two DOM nodes.
 *
 * @param boundaries Start and end marker nodes that define the render region.
 * @param options Root configuration.
 * @returns A virtual root controller.
 */
export function createRangeRoot(
  boundaries: [Node, Node],
  options: VirtualRootOptions = {},
): VirtualRoot {
  let [start, end] = boundaries
  let container = end.parentNode
  invariant(container, 'Expected parent node')
  invariant(start.parentNode === container, 'Boundaries must share parent')

  // An empty range has nothing to adopt. Otherwise the end marker bounds
  // hydration: content past it belongs to whatever owns the surrounding
  // region, not to this root.
  let hydrationStart = start.nextSibling
  let hasServerContent = hydrationStart !== null && hydrationStart !== end
  return createVirtualRoot({
    container,
    before: end,
    styles: options.styleManager ?? defaultStyleManager,
    hydration: hasServerContent ? { current: hydrationStart, end } : undefined,
    componentId: getHydrationComponentIdFromRangeStart(start),
    options,
  })
}

/**
 * Creates a virtual root for a host container element.
 *
 * @param container Host element to render into.
 * @param options Root configuration.
 * @returns A virtual root controller.
 */
export function createRoot(container: HTMLElement, options: VirtualRootOptions = {}): VirtualRoot {
  let styles = options.styleManager ?? defaultStyleManager
  let hasServerContent = container.innerHTML.trim() !== ''
  if (hasServerContent) {
    // Adopt additively: multiple roots hydrating separate islands may share
    // the default style manager, and adopting a later island must not release
    // the server styles an earlier island still depends on.
    styles.adoptServerStyles(container)
  }

  return createVirtualRoot({
    container,
    before: null,
    styles,
    hydration: hasServerContent ? { current: container.firstChild } : undefined,
    componentId: undefined,
    options,
  })
}

function createVirtualRoot(target: VirtualRootTarget): VirtualRoot {
  let { container, before, styles, options } = target
  let currentElement: RemixNode | undefined
  let hydration = target.hydration

  let eventTarget = new TypedEventTarget<VirtualRootEventMap>()
  let scheduler =
    options.scheduler ?? createScheduler(container.ownerDocument ?? document, eventTarget)
  let frameHandle =
    options.frame ??
    createRootFrameHandle({
      src: options.frameInit?.src,
      resolveFrame: options.frameInit?.resolveFrame,
      loadModule: options.frameInit?.loadModule,
      errorTarget: eventTarget,
      scheduler,
      styleManager: styles,
    })

  let renderer = createRenderer(createDomHost(scheduler, styles))

  function createCoreRoot() {
    return renderer.createRoot(container, {
      scheduler,
      frame: frameHandle,
      before,
      hydration,
      componentId: target.componentId,

      getFrameByName(name) {
        let runtime = frameHandle.$runtime
        return isFrameRuntime(runtime) ? runtime.namedFrames.get(name) : undefined
      },

      getTopFrame() {
        let runtime = frameHandle.$runtime
        return isFrameRuntime(runtime) ? runtime.topFrame : undefined
      },

      shouldRemountComponent(type) {
        return componentStalenessCheck !== null && componentStalenessCheck(type) === true
      },
    })
  }

  let core = createCoreRoot()
  let disposed = false

  let isErrorForwardingAttached = false
  function forwardDomError(event: Event) {
    eventTarget.dispatchEvent(createComponentErrorEvent(getComponentError(event)))
  }
  function attachDomErrorForwarding() {
    if (isErrorForwardingAttached) return
    container.addEventListener('error', forwardDomError)
    isErrorForwardingAttached = true
  }
  function detachDomErrorForwarding() {
    if (!isErrorForwardingAttached) return
    container.removeEventListener('error', forwardDomError)
    isErrorForwardingAttached = false
  }
  attachDomErrorForwarding()

  let root = Object.assign(eventTarget, {
    render(element: RemixNode) {
      attachDomErrorForwarding()
      currentElement = element

      if (disposed) {
        core = createCoreRoot()
        disposed = false
      }
      // This render claims whatever the server left behind, so a root created
      // after it never re-adopts content the previous root removed. A root
      // disposed before it ever rendered leaves the server content untouched
      // and a later render still hydrates it.
      hydration = undefined

      // Rendering through the scheduler keeps DOM roots on the DOM error
      // policy: a failed render is logged and reported as an error event
      // instead of thrown at whoever called render().
      let mounted = core
      scheduler.enqueueWork([() => mounted.render(element)])
      scheduler.flush()
    },

    reconcile() {
      if (currentElement === undefined) return
      root.render(currentElement)
    },

    dispose() {
      detachDomErrorForwarding()
      unregisterRoot(root)
      currentElement = undefined

      if (disposed) return
      disposed = true
      let mounted = core
      scheduler.enqueueWork([() => mounted.unmount()])
      scheduler.flush()
    },

    flush() {
      scheduler.flush()
    },
  })

  registerRoot(root)
  return root
}

function createRootFrameHandle(init: {
  src?: string
  resolveFrame?: ResolveFrame
  loadModule?: (moduleUrl: string, exportName: string) => Promise<Function> | Function
  errorTarget: EventTarget
  scheduler: Scheduler
  styleManager: StyleManager
}): FrameHandle {
  let resolveFrame =
    init.resolveFrame ??
    (() => {
      throw new Error(
        'Cannot render <Frame /> without frame runtime. Use run() or pass frameInit to createRoot/createRangeRoot.',
      )
    })

  let runtime = createFrameRuntime({
    topFrame: undefined,
    loadModule:
      init.loadModule ??
      (() => {
        throw new Error('loadModule is required to hydrate client entries inside <Frame />')
      }),
    resolveFrame,
    errorTarget: init.errorTarget,
    pendingClientEntries: new Map(),
    scheduler: init.scheduler,
    styleManager: init.styleManager,
    moduleCache: new Map(),
    moduleLoads: new Map(),
    frameInstances: new WeakMap(),
    namedFrames: new Map(),
  })
  runtime.canResolveFrames = !!init.resolveFrame
  let frame = createFrameHandle({ src: init.src ?? '/', $runtime: runtime })
  runtime.topFrame = frame
  return frame
}
