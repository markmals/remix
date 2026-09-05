import { expect } from '@remix-run/assert'
import { describe, it } from '@remix-run/test'
import type { Assert, Equal } from './utils.ts'
import {
  createRenderer,
  createRendererPersistence,
  createRendererScheduler,
  type Renderer,
  type RendererHost,
  type RendererPersistence,
  type RendererRoot,
  type RendererScheduler,
} from '../renderer.ts'
import type { Handle, RemixNode } from '../runtime/component.ts'
import { createElement } from '../runtime/create-element.ts'
import type { Dispatched } from '../runtime/event-types.ts'
import type { ElementProps } from '../runtime/jsx.ts'
import { createMixin, renderMixinElement, type MixInput } from '../runtime/mixins/mixin.ts'
import type { MixinHandle } from '../runtime/mixins/mixin.ts'
import { on } from '../runtime/mixins/on-mixin.ts'
import { TypedEventTarget } from '../runtime/typed-event-target.ts'

const PRESS = 'test:press'

class TestPressEvent extends Event {
  readonly id: string

  constructor(id: string) {
    super(PRESS)
    this.id = id
  }
}

type TestElementEventMap = {
  [PRESS]: TestPressEvent
}

type TestStyle = { color?: string; weight?: string }

type TestText = { kind: 'text'; text: string; parent: TestElement | null }
type TestComment = { kind: 'comment'; text: string; parent: TestElement | null }
type TestNode = TestText | TestComment | TestElement

// The host's elements are event targets themselves, which is what lets the
// shared mixin runtime bind to them the way it binds to DOM elements.
class TestElement extends TypedEventTarget<TestElementEventMap> {
  kind = 'element' as const
  type: string
  attrs: Record<string, unknown> = {}
  children: TestNode[] = []
  parent: TestElement | null = null

  constructor(type: string) {
    super()
    this.type = type
  }
}

type BoxProps = {
  mix?: MixInput<TestElement>
  label?: string
  children?: RemixNode
}

function Box(handle: Handle<BoxProps>) {
  return () =>
    createElement(
      'box',
      { mix: handle.props.mix, label: handle.props.label },
      handle.props.children,
    )
}

/**
 * Composes a `style` prop the way a real host style mixin does: shallow merge
 * over whatever earlier mixins already composed, later value wins.
 */
const style = createMixin<TestElement, [style: TestStyle], ElementProps>(
  (handle) => (next, props) => {
    let previous = props.style as TestStyle | undefined
    return renderMixinElement(handle.element, { ...props, style: { ...previous, ...next } })
  },
)

type TestRenderer = {
  renderer: Renderer<TestNode, TestElement>
  root: RendererRoot
  container: TestElement
  output(): string
  errors: unknown[]
  findElement(type: string): TestElement
}

function serialize(node: TestNode): string {
  if (node.kind === 'text') return node.text
  if (node.kind === 'comment') return `<!--${node.text}-->`

  let attrs = Object.keys(node.attrs)
    .sort()
    .map((name) => ` ${name}=${JSON.stringify(node.attrs[name])}`)
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

function createTestRenderer(
  options: {
    eventTargets?: boolean
    getEventTarget?: RendererHost<TestNode, TestElement>['getEventTarget']
    createElement?: RendererHost<TestNode, TestElement>['createElement']
    commit?: RendererHost<TestNode, TestElement>['commit']
    persistence?: RendererPersistence<TestNode, TestElement>
    scheduler?: RendererScheduler<TestNode, TestElement>
  } = {},
): TestRenderer {
  let errors: unknown[] = []
  let container = new TestElement('root')

  let host: RendererHost<TestNode, TestElement> = {
    createElement(type, props) {
      let element = new TestElement(type)
      for (let name in props) {
        if (name === 'children' || name === 'mix' || name === 'key') continue
        if (props[name] !== undefined) element.attrs[name] = props[name]
      }
      return element
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
  }

  if (options.eventTargets !== false) {
    host.getEventTarget = options.getEventTarget ?? ((element) => element)
  }
  if (options.createElement) host.createElement = options.createElement
  if (options.commit) host.commit = options.commit
  if (options.persistence) host.persistence = options.persistence

  let renderer = createRenderer(host)
  let root = renderer.createRoot(container, { scheduler: options.scheduler })
  root.addEventListener('error', (event) => {
    event.preventDefault()
    errors.push(event.error)
  })

  function findElement(type: string): TestElement {
    let queue: TestElement[] = [container]
    while (queue.length > 0) {
      let element = queue.shift()!
      if (element !== container && element.type === type) return element
      for (let child of element.children) {
        if (child.kind === 'element') queue.push(child)
      }
    }
    throw new Error(`no <${type}> in the tree`)
  }

  return {
    renderer,
    root,
    container,
    output: () => container.children.map(serialize).join(''),
    errors,
    findElement,
  }
}

describe('universal renderer mixins', () => {
  describe('events', () => {
    it('binds on handlers to the host event target', () => {
      let { root, findElement } = createTestRenderer()
      let seen: Array<{ id: string; aborted: boolean }> = []

      root.render(
        <Box
          mix={on(PRESS, (event, signal) => {
            seen.push({ id: event.id, aborted: signal.aborted })
          })}
        />,
      )

      let box = findElement('box')
      box.dispatchEvent(new TestPressEvent('first'))
      box.dispatchEvent(new TestPressEvent('second'))

      expect(seen).toEqual([
        { id: 'first', aborted: false },
        { id: 'second', aborted: false },
      ])
    })

    it('swaps the handler across renders without rebinding the listener', () => {
      let { root, findElement } = createTestRenderer()
      let calls: string[] = []

      function App(handle: Handle<{ label: string }>) {
        return () => (
          <Box
            mix={on(PRESS, () => {
              calls.push(handle.props.label)
            })}
            label={handle.props.label}
          />
        )
      }

      root.render(<App label="first" />)
      let box = findElement('box')
      box.dispatchEvent(new TestPressEvent('a'))

      root.render(<App label="second" />)
      expect(findElement('box')).toBe(box)
      box.dispatchEvent(new TestPressEvent('b'))

      expect(calls).toEqual(['first', 'second'])
    })

    it('aborts the handler signal and unbinds when the element is removed', () => {
      let { root, findElement } = createTestRenderer()
      let signals: AbortSignal[] = []
      let calls = 0

      function App(handle: Handle<{ show: boolean }>) {
        return () => (
          <div>
            {handle.props.show ? (
              <Box
                mix={on(PRESS, (_event, signal) => {
                  calls++
                  signals.push(signal)
                })}
              />
            ) : null}
          </div>
        )
      }

      root.render(<App show={true} />)
      let box = findElement('box')
      box.dispatchEvent(new TestPressEvent('live'))
      expect(calls).toBe(1)
      expect(signals[0].aborted).toBe(false)

      root.render(<App show={false} />)

      expect(signals[0].aborted).toBe(true)
      box.dispatchEvent(new TestPressEvent('after removal'))
      expect(calls).toBe(1)
    })

    it('tears down mixins of a removed descendant', () => {
      let { root, findElement } = createTestRenderer()
      let calls = 0
      let removed = 0

      let counted = createMixin<TestElement, [], ElementProps>((handle) => {
        handle.addEventListener('remove', () => {
          removed++
        })
      })

      function App(handle: Handle<{ show: boolean }>) {
        return () =>
          handle.props.show ? (
            <Box label="outer">
              <Box
                mix={[
                  counted(),
                  on(PRESS, () => {
                    calls++
                  }),
                ]}
                label="inner"
              />
            </Box>
          ) : null
      }

      root.render(<App show={true} />)
      let inner = findElement('box').children[0] as TestElement
      inner.dispatchEvent(new TestPressEvent('live'))
      expect(calls).toBe(1)

      root.render(<App show={false} />)

      expect(removed).toBe(1)
      inner.dispatchEvent(new TestPressEvent('after removal'))
      expect(calls).toBe(1)
    })

    it('tears down mixins when mounting the element fails', () => {
      let { root } = createTestRenderer()
      let removed = 0

      let counted = createMixin<TestElement, [], ElementProps>((handle) => {
        handle.addEventListener('remove', () => {
          removed++
        })
      })

      function Bad(): never {
        throw new Error('child exploded')
      }

      expect(() => {
        root.render(
          <Box mix={counted()}>
            <Bad />
          </Box>,
        )
      }).toThrow('child exploded')

      root.flush()
      expect(removed).toBe(1)
    })
  })

  describe('props', () => {
    it('lets a later mixin win a shared key and keeps earlier keys', () => {
      let { root, output } = createTestRenderer()

      root.render(<Box mix={[style({ color: 'red', weight: 'bold' }), style({ color: 'blue' })]} />)

      expect(output()).toBe('<box style={"color":"blue","weight":"bold"}></box>')
    })

    it('normalizes falsy and nested mix values', () => {
      let { root, output } = createTestRenderer()

      root.render(<Box mix={[false, [style({ weight: 'bold' })], null]} />)

      expect(output()).toBe('<box style={"weight":"bold"}></box>')
    })

    it('removes composed props when the mixin is removed', () => {
      let { root, output } = createTestRenderer()

      function App(handle: Handle<{ styled: boolean }>) {
        return () => <Box mix={handle.props.styled && style({ color: 'red' })} />
      }

      root.render(<App styled={true} />)
      expect(output()).toBe('<box style={"color":"red"}></box>')

      root.render(<App styled={false} />)

      expect(output()).toBe('<box></box>')
    })
  })

  describe('lifecycle', () => {
    it('reports the node and its container on insert', () => {
      let { root, findElement, container } = createTestRenderer()
      let inserts: Array<{ node: unknown; parent: unknown }> = []

      let reporter = createMixin<TestElement, [], ElementProps>((handle) => {
        handle.addEventListener('insert', (event) => {
          inserts.push({ node: event.node, parent: event.parent })
        })
      })

      root.render(<Box mix={reporter()} />)

      expect(inserts).toHaveLength(1)
      expect(inserts[0].node).toBe(findElement('box'))
      expect(inserts[0].parent).toBe(container)
    })

    it('re-resolves props from handle.update() without re-rendering the component', async () => {
      let { root, output } = createTestRenderer()
      let renders = 0
      let color = 'red'
      let update: (() => Promise<AbortSignal>) | undefined

      let dynamic = createMixin<TestElement, [], ElementProps>((handle) => {
        update = () => handle.update()
        return (props) => renderMixinElement(handle.element, { ...props, style: { color } })
      })

      function App() {
        return () => {
          renders++
          return <Box mix={dynamic()} />
        }
      }

      root.render(<App />)
      expect(output()).toBe('<box style={"color":"red"}></box>')
      expect(renders).toBe(1)

      color = 'green'
      let signal = await update!()

      expect(signal.aborted).toBe(false)
      expect(renders).toBe(1)
      expect(output()).toBe('<box style={"color":"green"}></box>')
    })

    it('resolves queued mixin updates against the latest component props', async () => {
      let { root, output } = createTestRenderer()
      let updateMixin: (() => Promise<AbortSignal>) | undefined
      let componentHandle: Handle | undefined
      let label = 'old'
      let suffix = '!'
      let dynamic = createMixin<TestElement>((handle) => {
        updateMixin = () => handle.update()
        return (props) =>
          renderMixinElement(handle.element, {
            ...props,
            label: `${props.label}${suffix}`,
          })
      })

      function App(handle: Handle) {
        componentHandle = handle
        return () => <Box label={label} mix={dynamic()} />
      }

      root.render(<App />)
      suffix = '?'
      let mixinUpdate = updateMixin!()
      label = 'new'
      await Promise.all([mixinUpdate, componentHandle!.update()])

      expect(output()).toBe('<box label="new?"></box>')
      root.render(<App />)
      expect(output()).toBe('<box label="new?"></box>')
      root.unmount()
    })

    it('reads component context from a mixin', () => {
      let { root, output } = createTestRenderer()

      function Theme(handle: Handle<{ children: RemixNode }, { color: string }>) {
        handle.context.set({ color: 'teal' })
        return () => <div>{handle.props.children}</div>
      }

      let themed = createMixin<TestElement, [], ElementProps>((handle) => (props) => {
        let theme = handle.context.get(Theme) as { color: string } | undefined
        return renderMixinElement(handle.element, { ...props, style: { color: theme?.color } })
      })

      root.render(
        <Theme>
          <Box mix={themed()} />
        </Theme>,
      )

      expect(output()).toBe('<div><box style={"color":"teal"}></box></div>')
    })

    it('runs mixin tasks against the bound event target', () => {
      let { root, findElement } = createTestRenderer()
      let taskNodes: unknown[] = []

      let tasked = createMixin<TestElement, [], ElementProps>((handle) => {
        handle.queueTask((node) => {
          taskNodes.push(node)
        })
      })

      root.render(<Box mix={tasked()} />)

      expect(taskNodes).toHaveLength(1)
      expect(taskNodes[0]).toBe(findElement('box'))
    })

    it('aborts persistNode teardown instead of retaining the node', async () => {
      let { root, output } = createTestRenderer()
      let teardownSignals: AbortSignal[] = []

      let persisting = createMixin<TestElement, [], ElementProps>((handle) => {
        handle.addEventListener('beforeRemove', (event) => {
          event.persistNode((signal) => {
            teardownSignals.push(signal)
          })
        })
      })

      root.render(<Box mix={persisting()} />)
      root.render(null)
      root.flush()
      // The teardown itself runs in a microtask; the renderer removed the node
      // regardless, so the signal it receives is already aborted.
      await Promise.resolve()

      expect(output()).toBe('')
      expect(teardownSignals).toHaveLength(1)
      expect(teardownSignals[0].aborted).toBe(true)
    })
  })

  describe('host support', () => {
    it('releases a subtree when the host rejects its event target', () => {
      let failure = new Error('event target rejected')
      let { root, output } = createTestRenderer({
        getEventTarget() {
          throw failure
        },
      })
      let mixinSignal: AbortSignal | undefined
      let childSignal: AbortSignal | undefined
      let lifetime = createMixin<TestElement>((handle) => {
        mixinSignal = handle.signal
      })
      function Child(handle: Handle) {
        childSignal = handle.signal
        return () => <span>child</span>
      }

      expect(() =>
        root.render(
          <Box mix={lifetime()}>
            <Child />
          </Box>,
        ),
      ).toThrow(failure)
      expect(output()).toBe('')
      expect(mixinSignal!.aborted).toBe(true)
      expect(childSignal!.aborted).toBe(true)
      root.unmount()
    })

    it('releases mixin setup when the host cannot create the element', () => {
      let failure = new Error('element rejected')
      let { root, output } = createTestRenderer({
        createElement() {
          throw failure
        },
      })
      let signal: AbortSignal | undefined
      let lifetime = createMixin<TestElement>((handle) => {
        signal = handle.signal
      })

      expect(() => root.render(<Box mix={lifetime()} />)).toThrow(failure)
      expect(output()).toBe('')
      expect(signal!.aborted).toBe(true)
      root.unmount()
    })
    it('rejects mix when the host cannot expose an event target', () => {
      let { root, output } = createTestRenderer({ eventTargets: false })

      expect(() => root.render(<Box mix={on(PRESS, () => {})} />)).toThrow(
        'implement host.getEventTarget',
      )
      expect(output()).toBe('')
    })
  })

  describe('shared scheduler', () => {
    it('publishes an outer render once, after a nested root render completes', () => {
      let commits: string[] = []
      let schedulerErrors: unknown[] = []
      let scheduler = createRendererScheduler<TestNode, TestElement>({
        reportError(error) {
          schedulerErrors.push(error)
        },
      })
      let { root, container, renderer } = createTestRenderer({
        scheduler,
        commit(target) {
          commits.push(`${target.type}:${target.children.map(serialize).join('')}`)
        },
      })
      let nestedContainer = new TestElement('nested')
      let nestedRoot = renderer.createRoot(nestedContainer, { scheduler })

      let insertSnapshots: string[] = []
      let reporter = createMixin<TestElement, [], ElementProps>((handle) => {
        handle.addEventListener('insert', () => {
          insertSnapshots.push(container.children.map(serialize).join(''))
        })
      })

      // A portal-style child renders another root through the same scheduler
      // while the tree it belongs to is still being built.
      function Portal() {
        nestedRoot.render(<Box label="portal" />)
        return () => <Box label="middle" />
      }

      let taskSnapshots: string[] = []
      function Outer(handle: Handle) {
        handle.queueTask(() => {
          taskSnapshots.push(container.children.map(serialize).join(''))
        })
        return () => (
          <Box label="outer">
            <Box label="first" mix={reporter()} />
            <Portal />
            <Box label="tail" />
          </Box>
        )
      }

      root.render(<Outer />)

      let output =
        '<box label="outer"><box label="first"></box><box label="middle"></box>' +
        '<box label="tail"></box></box>'
      expect(container.children.map(serialize).join('')).toBe(output)
      expect(commits).toEqual([`root:${output}`, 'nested:<box label="portal"></box>'])
      expect(insertSnapshots).toEqual([output])
      expect(taskSnapshots).toEqual([output])
      expect(schedulerErrors).toEqual([])

      root.unmount()
      nestedRoot.unmount()
    })

    it('moves a reclaimed element onto the adopting root scheduler', () => {
      let persistence = createRendererPersistence<TestNode, TestElement>()
      let log: string[] = []
      let releaseTeardown: (() => void) | undefined

      let persisted = createMixin<TestElement, [], ElementProps>((handle) => {
        handle.addEventListener('insert', () => {
          log.push('insert')
        })
        handle.addEventListener('reclaimed', () => {
          log.push('reclaimed')
          handle.queueTask(() => {
            log.push('task')
          })
        })
        handle.addEventListener('commit', () => {
          log.push('commit')
        })
        handle.addEventListener('beforeRemove', (event) => {
          event.persistNode(
            () =>
              new Promise<void>((resolve) => {
                releaseTeardown = resolve
              }),
          )
        })
      })

      let { root, container, renderer, errors, findElement } = createTestRenderer({ persistence })
      root.render(createElement('box', { key: 'k', mix: persisted(), label: 'first' }))
      let box = findElement('box')
      expect(log).toEqual(['insert'])

      // The first root lets the element go and is disposed, but its mixin holds
      // the removal open, so the node stays for the next root to reclaim.
      root.render(null)
      root.unmount()
      expect(box.parent).toBe(container)

      let update = () => {}
      function Adopting(handle: Handle) {
        update = () => {
          handle.update()
        }
        return () => createElement('box', { key: 'k', mix: persisted(), label: 'second' })
      }

      log.length = 0
      let adoptingRoot = renderer.createRoot(container)
      adoptingRoot.addEventListener('error', (event) => {
        event.preventDefault()
        errors.push(event.error)
      })
      adoptingRoot.render(<Adopting />)

      // Reclaim and the work it queues belong to the batch that adopted the
      // element, not to the scheduler of the root that released it.
      expect(log).toEqual(['reclaimed', 'commit', 'task'])
      expect(findElement('box')).toBe(box)
      expect(box.attrs.label).toBe('second')

      log.length = 0
      update()
      adoptingRoot.flush()

      // Commit-phase lifecycles now ride the adopting root's update batches.
      expect(log).toEqual(['commit'])
      expect(errors).toEqual([])

      releaseTeardown?.()
    })
  })

  describe('types', () => {
    it('infers the event target and payload from host context', () => {
      /* oxlint-disable eslint/no-unused-vars */
      let inferred = (
        <Box
          mix={on(PRESS, (event, signal) => {
            type inferredEvent = Assert<
              Equal<typeof event, Dispatched<TestPressEvent, TestElement>>
            >
            type inferredTarget = Assert<Equal<typeof event.currentTarget, TestElement>>
            type inferredId = Assert<Equal<typeof event.id, string>>
            type inferredSignal = Assert<Equal<typeof signal, AbortSignal>>
          })}
        />
      )

      let explicit = (
        <Box
          mix={on<TestElement>(PRESS, (event) => {
            type inferredEvent = Assert<
              Equal<typeof event, Dispatched<TestPressEvent, TestElement>>
            >
          })}
        />
      )

      let unknownEvent = (
        <Box
          // @ts-expect-error the host's event map has no `click`
          mix={on('click', () => {})}
        />
      )

      let domTargetsUnchanged = (
        <button
          mix={on('pointerdown', (event) => {
            type inferredEvent = Assert<
              Equal<typeof event, Dispatched<PointerEvent, HTMLButtonElement>>
            >
          })}
        />
      )
      let terminalPlacement = createMixin<TestElement>((handle) => {
        let broaderHandle: MixinHandle<EventTarget> = handle
        handle.addEventListener('insert', (event) => {
          type inferredParent = Assert<Equal<typeof event.parent, object>>
        })
        handle.addEventListener('reclaimed', (event) => {
          type inferredParent = Assert<Equal<typeof event.parent, object>>
        })
      })
      let domPlacement = createMixin<HTMLButtonElement>((handle) => {
        let broaderHandle: MixinHandle<Element> = handle
        handle.addEventListener('insert', (event) => {
          type inferredParent = Assert<Equal<typeof event.parent, ParentNode>>
        })
        handle.addEventListener('reclaimed', (event) => {
          type inferredParent = Assert<Equal<typeof event.parent, ParentNode>>
        })
      })
      /* oxlint-enable eslint/no-unused-vars */
    })
  })
})
