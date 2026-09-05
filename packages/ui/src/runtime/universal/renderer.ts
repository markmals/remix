import { createFrameHandle } from '../component.ts'
import type { RemixNode } from '../jsx.ts'
import { TypedEventTarget } from '../typed-event-target.ts'
import { ROOT_VNODE } from '../vnode.ts'
import { createRendererScheduler } from './batch.ts'
import type { Renderer, RendererHost, RendererRoot, RendererRootEventMap } from './host.ts'
import { createReconciler, FRAMES_UNSUPPORTED, type UniversalContext } from './reconcile.ts'
import type { RendererRootOptions } from './root-options.ts'
import type { MountedRoot } from './vnode.ts'

let componentCount = 0

/**
 * Creates a renderer from host operations, without depending on DOM globals.
 *
 * DOM, terminal and custom hosts share component lifetimes, keyed reconciliation,
 * mixins and scheduling. Optional host capabilities add hydration, Frames, shared
 * elements and retained-node removal without replacing the reconciliation engine.
 *
 * @param host Operations for the target node graph.
 * @returns A renderer that creates independently owned roots.
 */
export function createRenderer<
  node extends object,
  element extends node,
  container extends node = element,
>(host: RendererHost<node, element, container>): Renderer<node, element, container> {
  let reconciler = createReconciler(host)

  return {
    createRoot(
      container: container,
      options: RendererRootOptions<node, element, container> = {},
    ): RendererRoot {
      if (options.hydration && !host.hydration) {
        throw new Error('Hydration is not supported by this renderer host')
      }

      let events = new TypedEventTarget<RendererRootEventMap>()
      let root: MountedRoot<node, element, container> = {
        kind: 'root',
        type: ROOT_VNODE,
        _node: container,
        _children: [],
        _anchor: options.before,
        _componentId: options.componentId,
      }
      let unmounted = false
      let scheduler =
        options.scheduler ??
        createRendererScheduler<node, element, container>({
          reportError(error) {
            let event = Object.assign(new Event('error', { cancelable: true }), { error })
            if (!events.dispatchEvent(event)) return
            setTimeout(() => {
              throw error
            }, 0)
          },
        })
      let frame = options.frame ?? createUnsupportedFrame()
      let context: UniversalContext<node, element, container> = {
        frame,
        scheduler,
        reconciler,
        hydration: options.hydration,
        nextComponentId(parent) {
          if (parent.kind === 'root' && parent._componentId !== undefined) {
            let id = parent._componentId
            parent._componentId = undefined
            return id
          }
          return `c${++componentCount}`
        },
        getFrameByName(name) {
          return options.getFrameByName?.(name)
        },
        getTopFrame() {
          return options.getTopFrame?.() ?? frame
        },
        shouldRemountComponent: options.shouldRemountComponent,
        markDirty() {
          if (host.commit) scheduler.markDirty(commit)
        },
      }

      function commit(): void {
        host.commit?.(container)
      }

      return Object.assign(events, {
        render(input: RemixNode): void {
          if (unmounted) throw new Error('Cannot render an unmounted root')
          scheduler.runSync(() => {
            context.markDirty()
            let current = root._children.length > 0 ? root._children[0] : null
            let committed = reconciler.renderRoot(current, input, root, context)
            root._children[0] = committed
            context.hydration = undefined
          })
        },
        flush(): void {
          scheduler.flush()
        },
        unmount(): void {
          if (unmounted) return
          unmounted = true
          if (root._children.length === 0) return
          scheduler.runSync(() => {
            context.markDirty()
            let current = root._children[0]
            root._children.length = 0
            reconciler.removeNode(current, context)
          })
        },
      })
    },
  }
}

function createUnsupportedFrame() {
  return createFrameHandle({
    replace() {
      throw new Error(FRAMES_UNSUPPORTED)
    },
    reload() {
      throw new Error(FRAMES_UNSUPPORTED)
    },
  })
}
