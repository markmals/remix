import { createFrameHandle } from '../component.ts'
import { createCancelableComponentErrorEvent } from '../error-event.ts'
import type { RemixNode } from '../jsx.ts'
import { TypedEventTarget } from '../typed-event-target.ts'
import { ROOT_VNODE } from '../vnode.ts'
import type { Renderer, RendererHost, RendererRoot, RendererRootEventMap } from './host.ts'
import { createReconciler, FRAMES_UNSUPPORTED, type UniversalContext } from './reconcile.ts'
import { createUpdateScheduler } from './scheduler.ts'
import { hasScheduledAncestor, type MountedComponent, type MountedRoot } from './vnode.ts'

/**
 * Creates a renderer for a host.
 *
 * The renderer is host-agnostic and DOM-free: component semantics, keyed
 * identity, fragment ranges, and update batching are shared with the DOM
 * renderer, while every mutation goes through the host operations.
 *
 * @example Rendering into a custom node graph
 * ```ts
 * let renderer = createRenderer<SceneNode, SceneElement>(host)
 * let root = renderer.createRoot(container)
 * root.addEventListener('error', (event) => {
 *   event.preventDefault()
 *   report(event.error)
 * })
 * root.render(<App />)
 * ```
 *
 * @param host Host operations used to mutate the target tree.
 * @returns A renderer bound to the host.
 */
export function createRenderer<node extends object, element extends node>(
  host: RendererHost<node, element>,
): Renderer<element> {
  let reconciler = createReconciler(host)
  let componentCount = 0

  return {
    createRoot(container: element): RendererRoot {
      let events = new TypedEventTarget<RendererRootEventMap>()
      let root: MountedRoot<node, element> = {
        kind: 'root',
        type: ROOT_VNODE,
        _node: container,
        _children: [],
      }
      let unmounted = false
      let context: UniversalContext<node, element>

      let scheduler = createUpdateScheduler<MountedComponent<node, element>, element>({
        update(target, updateParent) {
          reconciler.updateComponent(target, updateParent, context)
        },
        release(target) {
          reconciler.releaseComponent(target, context)
        },
        hasScheduledAncestor,
        describe: (target) => target.type.name || 'Anonymous',
        commit: () => host.commit?.(container),
        reportError(error) {
          // Errors from a scheduled update or a component task have no caller
          // to throw to. Listeners can claim one with preventDefault();
          // anything nobody claims is rethrown rather than swallowed.
          let handled = !events.dispatchEvent(createCancelableComponentErrorEvent(error))
          if (handled) return
          setTimeout(() => {
            throw error
          })
        },
      })

      context = {
        frame: createFrameHandle({
          replace() {
            throw new Error(FRAMES_UNSUPPORTED)
          },
          reload() {
            throw new Error(FRAMES_UNSUPPORTED)
          },
        }),
        scheduler,
        nextComponentId: () => `c${++componentCount}`,
      }

      return Object.assign(events, {
        render(element: RemixNode): void {
          if (unmounted) throw new Error('Cannot render into an unmounted renderer root')

          scheduler.runSync(() => {
            let curr = root._children.length > 0 ? root._children[0] : null
            let committed = reconciler.renderRoot(curr, element, root, context)
            if (root._children.length === 0) {
              root._children.push(committed)
            } else {
              root._children[0] = committed
            }
          })
        },

        flush(): void {
          scheduler.flush()
        },

        unmount(): void {
          if (unmounted) return
          unmounted = true

          if (root._children.length === 0) return
          let mounted = root._children[0]
          root._children.length = 0
          scheduler.runSync(() => reconciler.removeNode(mounted, context))
        },
      })
    },
  }
}
