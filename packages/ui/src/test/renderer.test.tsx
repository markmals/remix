import { expect } from '@remix-run/assert'
import { describe, it } from '@remix-run/test'
import { createRenderer, type RendererHost, type RendererRoot } from '../renderer.ts'
import { Frame, type Handle, type RemixNode } from '../runtime/component.ts'
import { on } from '../runtime/mixins/on-mixin.ts'

type TestText = { kind: 'text'; text: string; parent: TestElement | null }
type TestComment = { kind: 'comment'; text: string; parent: TestElement | null }
type TestElement = {
  kind: 'element'
  type: string
  attrs: Record<string, unknown>
  children: TestNode[]
  parent: TestElement | null
}
type TestNode = TestText | TestComment | TestElement

type TestRenderer = {
  root: RendererRoot
  container: TestElement
  /** Serialized container children, so assertions read like markup. */
  output(): string
  /** Snapshot of the tree at each commit, newest last. */
  commits: string[]
  errors: unknown[]
}

function serialize(node: TestNode): string {
  if (node.kind === 'text') return node.text
  if (node.kind === 'comment') return `<!--${node.text}-->`

  let attrs = Object.keys(node.attrs)
    .sort()
    .map((name) => ` ${name}="${String(node.attrs[name])}"`)
    .join('')
  return `<${node.type}${attrs}>${node.children.map(serialize).join('')}</${node.type}>`
}

function detach(node: TestNode): void {
  let parent = node.parent
  if (!parent) return
  let index = parent.children.indexOf(node)
  if (index !== -1) parent.children.splice(index, 1)
  node.parent = null
}

// Strict insertion exposes invalid renderer anchors instead of silently appending.
function createTestRenderer(
  options: {
    onCommit?: (output: string) => void
    shouldRemountComponent?: () => boolean
  } = {},
): TestRenderer {
  let commits: string[] = []
  let errors: unknown[] = []
  let container: TestElement = {
    kind: 'element',
    type: 'root',
    attrs: {},
    children: [],
    parent: null,
  }

  let host: RendererHost<TestNode, TestElement> = {
    createElement(type, props) {
      let attrs: Record<string, unknown> = {}
      for (let name in props) {
        if (name === 'children' || name === 'mix' || name === 'key') continue
        attrs[name] = props[name]
      }
      return { kind: 'element', type, attrs, children: [], parent: null }
    },
    createText(text) {
      return { kind: 'text', text, parent: null }
    },
    createComment(text) {
      return { kind: 'comment', text, parent: null }
    },
    setText(node, text) {
      if (node.kind === 'element') throw new Error('setText called on an element')
      node.text = text
    },
    patchProps(element, previous, next) {
      for (let name in previous) {
        if (!(name in next) || next[name] === undefined) delete element.attrs[name]
      }
      for (let name in next) {
        if (name === 'children' || name === 'mix' || name === 'key') continue
        if (next[name] !== undefined) element.attrs[name] = next[name]
      }
    },
    insert(node, parent, before) {
      detach(node)
      let index = parent.children.length
      if (before !== null) {
        index = parent.children.indexOf(before)
        if (index === -1) throw new Error('insertion anchor is not a child of the parent')
      }
      parent.children.splice(index, 0, node)
      node.parent = parent
    },
    remove(node) {
      detach(node)
    },
    parentNode(node) {
      return node.parent
    },
    nextSibling(node) {
      let parent = node.parent
      if (!parent) return null
      let index = parent.children.indexOf(node)
      if (index === -1) return null
      return parent.children[index + 1] ?? null
    },
    commit(target) {
      let output = target.children.map(serialize).join('')
      commits.push(output)
      options.onCommit?.(output)
    },
  }

  let root = createRenderer(host).createRoot(container, {
    shouldRemountComponent: options.shouldRemountComponent,
  })
  root.addEventListener('error', (event) => {
    event.preventDefault()
    errors.push(event.error)
  })

  return {
    root,
    container,
    output: () => container.children.map(serialize).join(''),
    commits,
    errors,
  }
}

describe('createRenderer', () => {
  describe('rendering', () => {
    it('renders primitives, empty children, and nested arrays as one flat range', () => {
      let { root, output } = createTestRenderer()

      root.render(
        <div>
          {'a'}
          {1}
          {null}
          {false}
          {[['b'], 'c']}
        </div>,
      )

      expect(output()).toBe('<div>a1bc</div>')
    })

    it('reuses the host element and text node across updates', () => {
      let { root, container } = createTestRenderer()

      root.render(<div>one</div>)
      let element = container.children[0] as TestElement
      let text = element.children[0]

      root.render(<div>two</div>)

      expect(container.children[0]).toBe(element)
      expect(element.children[0]).toBe(text)
      expect(serialize(element)).toBe('<div>two</div>')
    })

    it('resolves component context through host ancestors', () => {
      let { root, output } = createTestRenderer()

      function Provider(handle: Handle<{ children: RemixNode }, { theme: string }>) {
        handle.context.set({ theme: 'dark' })
        return () => <div>{handle.props.children}</div>
      }

      function Consumer(handle: Handle) {
        return () => <span>{handle.context.get(Provider).theme}</span>
      }

      root.render(
        <Provider>
          <section>
            <Consumer />
          </section>
        </Provider>,
      )

      expect(output()).toBe('<div><section><span>dark</span></section></div>')
    })
  })

  describe('placement', () => {
    it('mounts a previously empty child before its existing sibling', () => {
      let { root, output } = createTestRenderer()

      function Toggle(handle: Handle<{ show: boolean }>) {
        return () => (
          <div>
            {handle.props.show ? <b>on</b> : null}
            <span>tail</span>
          </div>
        )
      }

      root.render(<Toggle show={false} />)
      expect(output()).toBe('<div><span>tail</span></div>')

      root.render(<Toggle show={true} />)
      expect(output()).toBe('<div><b>on</b><span>tail</span></div>')

      root.render(<Toggle show={false} />)
      expect(output()).toBe('<div><span>tail</span></div>')
    })

    it('appends new fragment children before the fragment sibling, not at the end', () => {
      let { root, output } = createTestRenderer()

      function List(handle: Handle<{ items: string[] }>) {
        return () => (
          <div>
            <>
              {handle.props.items.map((item) => (
                <b>{item}</b>
              ))}
            </>
            tail
          </div>
        )
      }

      root.render(<List items={['x']} />)
      expect(output()).toBe('<div><b>x</b>tail</div>')

      root.render(<List items={['x', 'y']} />)
      expect(output()).toBe('<div><b>x</b><b>y</b>tail</div>')

      root.render(<List items={[]} />)
      expect(output()).toBe('<div>tail</div>')
    })

    it('moves whole host ranges when keyed multi-node children reorder', () => {
      let { root, container, output } = createTestRenderer()

      function Row(handle: Handle<{ label: string }>) {
        return () => (
          <>
            <span>{handle.props.label}</span>
            <b>{handle.props.label}</b>
          </>
        )
      }

      function List(handle: Handle<{ order: string[] }>) {
        return () => (
          <div>
            {handle.props.order.map((id) => (
              <Row key={id} label={id} />
            ))}
          </div>
        )
      }

      root.render(<List order={['a', 'b', 'c']} />)
      let list = container.children[0] as TestElement
      let spanA = list.children[0]
      let boldA = list.children[1]

      root.render(<List order={['c', 'a', 'b']} />)

      expect(output()).toBe(
        '<div><span>c</span><b>c</b><span>a</span><b>a</b><span>b</span><b>b</b></div>',
      )
      expect(list.children[2]).toBe(spanA)
      expect(list.children[3]).toBe(boldA)
    })

    it('keeps sibling order when a keyed child changes element type', () => {
      let { root, output } = createTestRenderer()

      function List(handle: Handle<{ swap: boolean }>) {
        return () => (
          <div>
            <span key="one">one</span>
            {handle.props.swap ? <b key="two">two</b> : <span key="two">two</span>}
            <span key="three">three</span>
          </div>
        )
      }

      root.render(<List swap={false} />)
      expect(output()).toBe('<div><span>one</span><span>two</span><span>three</span></div>')

      root.render(<List swap={true} />)
      expect(output()).toBe('<div><span>one</span><b>two</b><span>three</span></div>')
    })

    it('appends nested fragment children before the fragment, not the outer anchor', () => {
      let { root, output } = createTestRenderer()

      function List(handle: Handle<{ items: string[] }>) {
        return () => (
          <>
            <>
              {handle.props.items.map((item) => (
                <b>{item}</b>
              ))}
            </>
            <span>z</span>
          </>
        )
      }

      function App(handle: Handle<{ items: string[] }>) {
        return () => (
          <div>
            <List items={handle.props.items} />
            <i>q</i>
          </div>
        )
      }

      root.render(<App items={['a']} />)
      expect(output()).toBe('<div><b>a</b><span>z</span><i>q</i></div>')

      root.render(<App items={['a', 'b']} />)

      expect(output()).toBe('<div><b>a</b><b>b</b><span>z</span><i>q</i></div>')
    })

    it('grows keyed fragment content while removing its next sibling', () => {
      let { root, output } = createTestRenderer()

      function Item(handle: Handle<{ labels: string[] }>) {
        return () => (
          <>
            {handle.props.labels.map((label) => (
              <b>{label}</b>
            ))}
          </>
        )
      }

      root.render([
        <Item key="kept" labels={['a']} />,
        <Item key="removed" labels={['removed']} />,
        <Item key="last" labels={['z']} />,
      ])
      root.render([<Item key="kept" labels={['a', 'b']} />, <Item key="last" labels={['z']} />])

      expect(output()).toBe('<b>a</b><b>b</b><b>z</b>')
      root.unmount()
    })

    it('mounts late root-level children before host-owned trailing nodes', () => {
      let { root, container, output } = createTestRenderer()

      function List(handle: Handle<{ items: string[] }>) {
        return () => (
          <>
            {handle.props.items.map((item) => (
              <b>{item}</b>
            ))}
          </>
        )
      }

      root.render(<List items={['a']} />)

      // The embedder owns this node: the renderer manages only what it created,
      // so its own range has to stay in front of it.
      container.children.push({ kind: 'text', text: '|host|', parent: container })

      root.render(<List items={['a', 'b']} />)

      expect(output()).toBe('<b>a</b><b>b</b>|host|')
    })
  })

  describe('updates', () => {
    it('re-renders only the component that scheduled an update', async () => {
      let { root, output } = createTestRenderer()
      let renders = { left: 0, right: 0 }
      let leftHandle: Handle<{}> | undefined

      function Left(handle: Handle) {
        leftHandle = handle
        let count = 0
        return () => {
          renders.left++
          count++
          return <span>{count}</span>
        }
      }

      function Right() {
        return () => {
          renders.right++
          return <b>right</b>
        }
      }

      root.render(
        <div>
          <Left />
          <Right />
        </div>,
      )
      expect(renders).toEqual({ left: 1, right: 1 })

      await leftHandle!.update()

      expect(renders).toEqual({ left: 2, right: 1 })
      expect(output()).toBe('<div><span>2</span><b>right</b></div>')
    })

    it('renders a child once when both parent and child are queued', async () => {
      let { root } = createTestRenderer()
      let renders = { parent: 0, child: 0 }
      let parentHandle: Handle<{}> | undefined
      let childHandle: Handle<{}> | undefined

      function Child(handle: Handle) {
        childHandle = handle
        return () => {
          renders.child++
          return <span>child</span>
        }
      }

      function Parent(handle: Handle) {
        parentHandle = handle
        return () => {
          renders.parent++
          return (
            <div>
              <Child />
            </div>
          )
        }
      }

      root.render(<Parent />)
      expect(renders).toEqual({ parent: 1, child: 1 })

      let pendingChild = childHandle!.update()
      let pendingParent = parentHandle!.update()
      await Promise.all([pendingChild, pendingParent])

      expect(renders).toEqual({ parent: 2, child: 2 })
    })

    it('drops a queued update for a component that was removed first', async () => {
      let { root, output } = createTestRenderer()
      let renders = 0
      let childHandle: Handle<{}> | undefined

      function Child(handle: Handle) {
        childHandle = handle
        return () => {
          renders++
          return <span>child</span>
        }
      }

      function App(handle: Handle<{ show: boolean }>) {
        return () => <div>{handle.props.show ? <Child /> : null}</div>
      }

      root.render(<App show={true} />)
      expect(renders).toBe(1)

      let pending = childHandle!.update()
      root.render(<App show={false} />)

      let signal = await pending
      root.flush()

      expect(signal.aborted).toBe(true)
      expect(childHandle!.signal.aborted).toBe(true)
      expect(renders).toBe(1)
      expect(output()).toBe('<div></div>')
    })

    it('commits before component tasks and update promises observe the tree', async () => {
      let { root, commits } = createTestRenderer()
      let seenBySetupTask: string | undefined
      let seenByUpdate: string | undefined
      let handle: Handle<{}> | undefined

      function Counter(componentHandle: Handle) {
        handle = componentHandle
        let count = 0
        componentHandle.queueTask(() => {
          seenBySetupTask = commits.at(-1)
        })
        return () => {
          count++
          return <span>{count}</span>
        }
      }

      root.render(<Counter />)

      expect(commits).toEqual(['<span>1</span>'])
      expect(seenBySetupTask).toBe('<span>1</span>')

      await handle!.update().then(() => {
        seenByUpdate = commits.at(-1)
      })

      expect(commits).toEqual(['<span>1</span>', '<span>2</span>'])
      expect(seenByUpdate).toBe('<span>2</span>')
    })
  })

  describe('failures', () => {
    it('throws from render and releases components that already mounted', () => {
      let { root, output } = createTestRenderer()
      let mountedSignal: AbortSignal | undefined

      function Good(handle: Handle) {
        mountedSignal = handle.signal
        return () => <span>ok</span>
      }

      function Bad(): never {
        throw new Error('setup exploded')
      }

      expect(() => {
        root.render(
          <div>
            <Good />
            <Bad />
          </div>,
        )
      }).toThrow('setup exploded')

      expect(mountedSignal!.aborted).toBe(true)
      expect(output()).toBe('')
    })

    it('reports an update failure and settles the awaited update', async () => {
      let { root, errors, output } = createTestRenderer()
      let handle: Handle<{}> | undefined

      function Flaky(componentHandle: Handle) {
        handle = componentHandle
        let renders = 0
        return () => {
          renders++
          if (renders === 2) throw new Error('update exploded')
          return <span>ok</span>
        }
      }

      root.render(<Flaky />)
      let signal = await handle!.update()

      expect(errors).toHaveLength(1)
      expect((errors[0] as Error).message).toBe('update exploded')
      // The awaited render never happened, so its signal is aborted rather
      // than reporting a completed update.
      expect(signal.aborted).toBe(true)
      expect(output()).toBe('<span>ok</span>')
    })

    it('reports a commit failure and still runs component tasks', () => {
      let commitAttempts = 0
      let { root, errors, output } = createTestRenderer({
        onCommit() {
          commitAttempts++
          throw new Error('commit exploded')
        },
      })
      let taskRan = false

      function Counter(handle: Handle) {
        handle.queueTask(() => {
          taskRan = true
        })
        return () => <span>ok</span>
      }

      root.render(<Counter />)

      expect(commitAttempts).toBe(1)
      expect(errors).toHaveLength(1)
      expect((errors[0] as Error).message).toBe('commit exploded')
      expect(taskRan).toBe(true)
      expect(output()).toBe('<span>ok</span>')
    })

    it('stops a runaway update loop instead of hanging', async () => {
      let { root, errors } = createTestRenderer()
      let renders = 0
      let settled = false

      function Runaway(handle: Handle) {
        return () => {
          renders++
          handle.queueTask(() => {
            void handle.update().then(() => {
              settled = true
            })
          })
          return <span>{renders}</span>
        }
      }

      root.render(<Runaway />)
      await Promise.resolve()

      expect(errors).toHaveLength(1)
      expect((errors[0] as Error).message).toMatch('infinite loop detected in Runaway')
      expect(renders).toBeGreaterThan(1)
      expect(settled).toBe(true)
    })

    it('settles pending update promises on unmount', async () => {
      let { root, output } = createTestRenderer()
      let handle: Handle<{}> | undefined
      let connectedSignal: AbortSignal | undefined

      function Counter(componentHandle: Handle) {
        handle = componentHandle
        connectedSignal = componentHandle.signal
        return () => <span>value</span>
      }

      root.render(<Counter />)
      let pending = handle!.update()
      root.unmount()

      let signal = await pending

      expect(signal.aborted).toBe(true)
      expect(connectedSignal!.aborted).toBe(true)
      expect(output()).toBe('')
    })

    it('keeps an unmounted root closed across repeated unmounts', () => {
      let { root, output } = createTestRenderer()
      let setups = 0
      function App() {
        setups++
        return () => <span>mounted</span>
      }
      root.render(<App />)
      root.unmount()
      root.unmount()
      expect(() => root.render(<App />)).toThrow()
      expect(setups).toBe(1)
      expect(output()).toBe('')
    })

    it('rejects frames and DOM mixins instead of rendering nothing', () => {
      let frames = createTestRenderer()
      expect(() => frames.root.render(<Frame src="/somewhere" />)).toThrow(
        'Frames are not supported',
      )
      expect(frames.output()).toBe('')

      let mixins = createTestRenderer()
      expect(() => mixins.root.render(<div mix={[on('click', () => {})]}>content</div>)).toThrow(
        'Mixins are not supported',
      )
      expect(mixins.output()).toBe('')
    })

    it('removes siblings mounted in the same update when a later child throws', () => {
      let { root, output } = createTestRenderer()
      let mountedSignal: AbortSignal | undefined

      function Ok(handle: Handle<{ label: string }>) {
        if (handle.props.label === 'b') mountedSignal = handle.signal
        return () => <span>{handle.props.label}</span>
      }

      function Bad(): never {
        throw new Error('third exploded')
      }

      function List(handle: Handle<{ items: string[] }>) {
        return () => (
          <div>
            {handle.props.items.map((item) => (item === 'bad' ? <Bad /> : <Ok label={item} />))}
          </div>
        )
      }

      root.render(<List items={['a']} />)
      expect(output()).toBe('<div><span>a</span></div>')

      expect(() => root.render(<List items={['a', 'b', 'bad']} />)).toThrow('third exploded')

      expect(output()).toBe('<div><span>a</span></div>')
      expect(mountedSignal!.aborted).toBe(true)
    })

    it('owns child lifetimes after a host update rejects its props', async () => {
      let { root, output } = createTestRenderer()
      let childHandle: Handle<{}> | undefined
      let leafSignal: AbortSignal | undefined
      let showLeaf = false
      function Leaf(handle: Handle) {
        leafSignal = handle.signal
        return () => <i>leaf</i>
      }
      function Child(handle: Handle) {
        childHandle = handle
        return () => [<span>child</span>, showLeaf ? <Leaf /> : null]
      }
      root.render(
        <div>
          <Child />
        </div>,
      )
      expect(() =>
        root.render(
          <div mix={on('click', () => {})}>
            <Child />
          </div>,
        ),
      ).toThrow('Mixins are not supported')

      showLeaf = true
      await childHandle!.update()
      expect(output()).toBe('<div><span>child</span><i>leaf</i></div>')
      expect(leafSignal!.aborted).toBe(false)
      root.unmount()
      expect(leafSignal!.aborted).toBe(true)
      expect(output()).toBe('')
    })

    it('keeps siblings diffed before a failed child owned by the live tree', async () => {
      let { root, errors, output } = createTestRenderer()
      let goodHandle: Handle<{}> | undefined
      let parentHandle: Handle<{}> | undefined
      let failBad = false
      let showTail = false

      function Good(handle: Handle) {
        goodHandle = handle
        return () => [<span>head</span>, showTail ? <i>tail</i> : null]
      }

      function Bad() {
        return () => {
          if (failBad) throw new Error('bad exploded')
          return <b>bad</b>
        }
      }

      function Parent(handle: Handle) {
        parentHandle = handle
        return () => [<Good />, <Bad />]
      }

      root.render(<Parent />)
      expect(output()).toBe('<span>head</span><b>bad</b>')

      failBad = true
      await parentHandle!.update()
      expect(errors).toHaveLength(1)

      // Good diffed before Bad threw, so the live tree owns what that diff
      // produced: its own update has to resolve anchors against its real
      // siblings, and an unmount has to reach the nodes it mounted since.
      showTail = true
      await goodHandle!.update()
      expect(output()).toBe('<span>head</span><i>tail</i><b>bad</b>')

      root.unmount()
      expect(output()).toBe('')
    })

    it('keeps a forced remount reachable when a later child throws', () => {
      let cardSignals: AbortSignal[] = []
      let remount = false
      let { root, output } = createTestRenderer({
        // Stands in for hot module replacement: the mounted implementation is
        // stale, so a matching child remounts instead of updating.
        shouldRemountComponent: () => remount,
      })

      function Card(handle: Handle) {
        cardSignals.push(handle.signal)
        return () => <span>card</span>
      }

      function Bad(): never {
        throw new Error('bad exploded')
      }

      root.render([<Card />])
      expect(output()).toBe('<span>card</span>')

      remount = true
      expect(() => root.render([<Card />, <Bad />])).toThrow('bad exploded')

      // The remounted card replaced the node the previous tree pointed at, so
      // the live tree has to own it: its position, and its lifetime.
      expect(cardSignals).toHaveLength(2)
      expect(cardSignals[0]!.aborted).toBe(true)
      expect(cardSignals[1]!.aborted).toBe(false)
      expect(output()).toBe('<span>card</span>')

      root.unmount()
      expect(output()).toBe('')
      expect(cardSignals[1]!.aborted).toBe(true)
    })

    it('keeps a component updatable after an ancestor re-render failed its render', async () => {
      let { root, errors, output } = createTestRenderer()
      let childHandle: Handle<{}> | undefined
      let parentHandle: Handle<{}> | undefined
      let renders = 0
      let failChild = false

      function Child(handle: Handle) {
        childHandle = handle
        return () => {
          renders++
          if (failChild) throw new Error('child exploded')
          return <span>{renders}</span>
        }
      }

      function Parent(handle: Handle) {
        parentHandle = handle
        return () => (
          <div>
            <Child />
          </div>
        )
      }

      root.render(<Parent />)
      expect(renders).toBe(1)

      failChild = true
      await parentHandle!.update()
      expect(errors).toHaveLength(1)

      failChild = false
      let pending = childHandle!.update()
      root.flush()

      // The child is still mounted and visible, so its own update has to render
      // it rather than being dropped against a superseded node.
      expect(renders).toBe(3)
      expect(output()).toBe('<div><span>3</span></div>')
      expect((await pending).aborted).toBe(false)
    })

    it('settles a descendant update skipped for an ancestor whose render failed', async () => {
      let { root, errors } = createTestRenderer()
      let childHandle: Handle<{}> | undefined
      let parentHandle: Handle<{}> | undefined
      let failParent = false

      function Child(handle: Handle) {
        childHandle = handle
        return () => <span>child</span>
      }

      function Parent(handle: Handle) {
        parentHandle = handle
        return () => {
          if (failParent) throw new Error('parent exploded')
          return (
            <div>
              <Child />
            </div>
          )
        }
      }

      root.render(<Parent />)

      failParent = true
      let childAborted: boolean | undefined
      void childHandle!.update().then((signal) => {
        childAborted = signal.aborted
      })
      void parentHandle!.update()
      let settled = Promise.withResolvers<void>()
      setTimeout(settled.resolve, 0)
      await settled.promise

      expect(errors).toHaveLength(1)
      expect(childAborted).toBe(true)
    })

    it('preserves a committed descendant signal when an unrelated update fails', async () => {
      let { root, errors, output } = createTestRenderer()
      let childHandle: Handle | undefined
      let parentHandle: Handle | undefined
      let siblingHandle: Handle | undefined
      let failSibling = false
      let renders = 0
      let failure = new Error('sibling exploded')

      function Child(handle: Handle) {
        childHandle = handle
        return () => <span>{++renders}</span>
      }

      function Parent(handle: Handle) {
        parentHandle = handle
        return () => (
          <div>
            <Child />
          </div>
        )
      }

      function Sibling(handle: Handle) {
        siblingHandle = handle
        return () => {
          if (failSibling) throw failure
          return <b>sibling</b>
        }
      }

      root.render([<Parent />, <Sibling />])
      failSibling = true
      let childUpdate = childHandle!.update()
      let parentUpdate = parentHandle!.update()
      let siblingUpdate = siblingHandle!.update()
      let [childSignal] = await Promise.all([childUpdate, parentUpdate, siblingUpdate])

      expect(errors).toEqual([failure])
      expect(output()).toBe('<div><span>2</span></div><b>sibling</b>')
      expect(childSignal.aborted).toBe(false)
      root.unmount()
    })

    it('settles descendants skipped when their ancestor reaches the update limit', async () => {
      let { root, errors } = createTestRenderer()
      let childHandle: Handle | undefined
      let settled = 0
      let requested = 0

      function Child(handle: Handle) {
        childHandle = handle
        return () => <span>child</span>
      }

      function Runaway(handle: Handle) {
        return () => {
          handle.queueTask(() => {
            requested++
            void childHandle!.update().then(() => {
              settled++
            })
            void handle.update()
          })
          return <Child />
        }
      }

      root.render(<Runaway />)
      let tick = Promise.withResolvers<void>()
      setTimeout(tick.resolve, 0)
      await tick.promise

      expect(errors).toHaveLength(1)
      expect(settled).toBe(requested)
      root.unmount()
    })

    it('keeps the root usable after stopping a runaway update loop', async () => {
      let { root, errors, output } = createTestRenderer()
      let otherHandle: Handle<{}> | undefined

      function Other(handle: Handle) {
        otherHandle = handle
        let renders = 0
        return () => {
          renders++
          return <b>{renders}</b>
        }
      }

      function Runaway(handle: Handle) {
        let renders = 0
        return () => {
          renders++
          handle.queueTask(() => {
            void handle.update()
          })
          return <span>{renders}</span>
        }
      }

      root.render(
        <div>
          <Other />
          <Runaway />
        </div>,
      )
      let stopped = Promise.withResolvers<void>()
      setTimeout(stopped.resolve, 0)
      await stopped.promise
      expect(errors).toHaveLength(1)

      let signal = await otherHandle!.update()

      // The scheduler is not wedged by the runaway: a later update still runs.
      expect(signal.aborted).toBe(false)
      expect(output()).toMatch('<b>2</b>')
    })
  })
})
