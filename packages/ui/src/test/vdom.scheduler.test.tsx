import { expect } from '@remix-run/assert'
import { describe, it } from '@remix-run/test'
import { createRoot, createScheduler } from '../runtime/vdom.ts'
import type { Handle, RemixNode } from '../runtime/component.ts'

describe('vnode rendering', () => {
  describe('scheduling', () => {
    it('skips descendant updates if ancestor is scheduled', () => {
      let container = document.createElement('div')
      let root = createRoot(container)

      let capturedParentUpdate = () => {}
      let appRenderCount = 0
      function Parent(handle: Handle<{ children?: RemixNode }>) {
        capturedParentUpdate = () => {
          handle.update()
        }
        return () => {
          appRenderCount++
          return handle.props.children
        }
      }

      let childRenderCount = 0
      let capturedChildUpdate = () => {}
      function Child(handle: Handle) {
        capturedChildUpdate = () => {
          handle.update()
        }
        return () => {
          childRenderCount++
          return <div>Hello, world!</div>
        }
      }

      root.render(
        <Parent>
          <Child />
        </Parent>,
      )
      expect(container.innerHTML).toBe('<div>Hello, world!</div>')
      expect(appRenderCount).toBe(1)
      expect(childRenderCount).toBe(1)

      capturedChildUpdate()
      capturedParentUpdate()
      root.flush()

      expect(appRenderCount).toBe(2)
      expect(childRenderCount).toBe(2)

      // swap order
      capturedParentUpdate()
      capturedChildUpdate()
      root.flush()

      expect(appRenderCount).toBe(3)
      expect(childRenderCount).toBe(3)
    })

    it('only runs tasks once', async () => {
      let container = document.createElement('div')
      let root = createRoot(container)

      let taskCount = 0
      let capturedUpdate = () => {}
      function App(handle: Handle) {
        handle.queueTask(() => {
          taskCount++
        })

        capturedUpdate = () => {
          handle.queueTask(() => {
            taskCount++
          })
          handle.update()
        }
        return () => null
      }

      root.render(<App />)
      root.flush()
      expect(taskCount).toBe(1)

      capturedUpdate()
      root.flush()
      expect(taskCount).toBe(2)
    })

    it('keeps a nested root render inside the outer batch', () => {
      let outerContainer = document.createElement('div')
      let nestedContainer = document.createElement('div')
      let scheduler = createScheduler(document, new EventTarget())
      let outerRoot = createRoot(outerContainer, { scheduler })
      let nestedRoot = createRoot(nestedContainer, { scheduler })

      // A portal-style child renders another root through the same scheduler
      // while the tree it belongs to is still being built.
      function Portal() {
        nestedRoot.render(<span>portal</span>)
        return () => <b>middle</b>
      }

      let snapshots: string[] = []
      function App(handle: Handle) {
        handle.queueTask(() => {
          snapshots.push(`${outerContainer.innerHTML}|${nestedContainer.innerHTML}`)
        })
        return () => (
          <div>
            <Portal />
            <i>tail</i>
          </div>
        )
      }

      outerRoot.render(<App />)

      let outerHtml = '<div><b>middle</b><i>tail</i></div>'
      expect(outerContainer.innerHTML).toBe(outerHtml)
      expect(nestedContainer.innerHTML).toBe('<span>portal</span>')
      // Tasks run once, after both trees are in the document.
      expect(snapshots).toEqual([`${outerHtml}|<span>portal</span>`])

      outerRoot.dispose()
      nestedRoot.dispose()
    })
  })
})
