import { close, createTerm, fixed, grow, open, rgba, text } from '@bomb.sh/tty'
import type { InputEvent } from '@bomb.sh/tty'
import * as assert from '@remix-run/assert'
import { describe, it } from '@remix-run/test'
import type { Handle, RemixNode } from '@remix-run/ui'
import { on } from '@remix-run/ui'
import { jsx } from '@remix-run/ui/jsx-runtime'

import { Box, createRoot, style, TerminalPointerEvent, TerminalRenderError, Text } from './index.ts'
import type { TerminalBox, TerminalRoot } from './index.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface Session {
  root: TerminalRoot
  frames: string[]
  errors: unknown[]
  input: InputEvent[]
}

async function session(width = 20, height = 3): Promise<Session> {
  let frames: string[] = []
  let errors: unknown[] = []
  let input: InputEvent[] = []
  let root = await createRoot({
    width,
    height,
    write(output) {
      frames.push(decoder.decode(output))
    },
  })
  root.addEventListener('error', (event) => {
    event.preventDefault()
    errors.push(event.error)
  })
  root.addEventListener('input', (event) => {
    input.push(event.detail)
  })
  return { root, frames, errors, input }
}

// The tty parser decides when a buffered escape resolves from its own clock
// inside WASM, so fake timers cannot move it: these waits must be real.
function sleep(ms: number): Promise<void> {
  let { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

describe('createRoot', () => {
  it('writes a frame for a rendered tree and nothing for an identical one', async () => {
    let { root, frames } = await session()

    root.render(jsx(Text, { children: 'hello' }))
    assert.equal(frames.length, 1)
    assert.ok(frames[0]?.includes('hello'))

    root.render(jsx(Text, { children: 'hello' }))
    assert.equal(frames.length, 1)

    root.render(jsx(Text, { children: 'goodbye' }))
    assert.equal(frames.length, 2)
    assert.ok(frames[1]?.includes('goodbye'))

    root.unmount()
  })

  it('repaints only the changed cells for a batched component update', async () => {
    let { root, frames } = await session()
    let expected = await createTerm({ width: 20, height: 3 })
    let bump: (() => Promise<AbortSignal>) | undefined

    function Counter(handle: Handle): () => RemixNode {
      let count = 0
      bump = () => {
        count += 1
        return handle.update()
      }
      return () => jsx(Text, { children: `count ${count}` })
    }

    root.render(jsx(Counter, {}))
    assert.equal(frames[0], decoder.decode(expected.render([text('count 0')]).output))
    assert.ok(bump !== undefined)

    let first = bump()
    let second = bump()
    await Promise.all([first, second])
    assert.equal(frames.length, 2)
    assert.equal(frames[1], decoder.decode(expected.render([text('count 2')]).output))

    root.unmount()
  })

  it('redraws for a new size and skips a resize to the same size', async () => {
    let { root, frames } = await session()

    root.render(jsx(Text, { children: 'sized' }))
    assert.equal(frames.length, 1)

    root.resize(20, 3)
    assert.equal(frames.length, 1)

    root.resize(30, 4)
    assert.equal(frames.length, 2)
    assert.ok(frames[1]?.includes('sized'))

    root.unmount()
  })

  it('merges style mixins and clears the fields a removed one contributed', async () => {
    let { root, frames } = await session()
    let expected = await createTerm({ width: 20, height: 3 })
    let base = { layout: { width: fixed(6), height: fixed(1) } }
    let deselect: (() => Promise<AbortSignal>) | undefined

    function Row(handle: Handle): () => RemixNode {
      let selected = true
      deselect = () => {
        selected = false
        return handle.update()
      }
      return () =>
        jsx(Box, {
          id: 'row',
          mix: [style(base), selected && style({ bg: rgba(200, 40, 40) })],
          children: jsx(Text, { children: 'row' }),
        })
    }

    root.render(jsx(Row, {}))
    assert.equal(
      frames[0],
      decoder.decode(
        expected.render([open('row', { ...base, bg: rgba(200, 40, 40) }), text('row'), close()])
          .output,
      ),
    )
    assert.ok(deselect !== undefined)

    await deselect()
    assert.equal(frames.length, 2)
    assert.equal(
      frames[1],
      decoder.decode(expected.render([open('row', base), text('row'), close()]).output),
    )

    root.unmount()
  })

  it('hit tests pointer input against the rendered layout', async () => {
    let { root } = await session()
    let seen: string[] = []
    let clicked: Event | undefined
    let clickedId: string | undefined

    root.render(
      jsx(Box, {
        id: 'button',
        mix: [
          style({ layout: { width: fixed(6), height: fixed(1) } }),
          on<TerminalBox>('pointerenter', (event) => {
            seen.push(`enter:${event.id}`)
          }),
          on<TerminalBox>('pointerclick', (event) => {
            seen.push(`click:${event.id}`)
            clicked = event
            clickedId = event.currentTarget.id
          }),
          on<TerminalBox>('pointerleave', (event) => {
            seen.push(`leave:${event.id}`)
          }),
        ],
        children: jsx(Text, { children: 'press' }),
      }),
    )

    // SGR mouse reports are 1-based, so column 1 row 1 is the box's first cell.
    root.writeInput(encoder.encode('\x1b[<0;1;1M'))
    root.writeInput(encoder.encode('\x1b[<0;1;1m'))
    assert.deepEqual(seen, ['enter:button', 'click:button'])

    // Handlers receive a real event dispatched on the box itself.
    assert.ok(clicked instanceof TerminalPointerEvent)
    assert.equal(clicked.type, 'pointerclick')
    assert.equal(clicked.id, 'button')
    assert.equal(clickedId, 'button')

    root.writeInput(encoder.encode('\x1b[<0;18;3M'))
    assert.deepEqual(seen, ['enter:button', 'click:button', 'leave:button'])

    root.unmount()
  })

  it('targets only the row under the pointer for flush adjacent rows', async () => {
    let { root } = await session()
    let clicks: string[] = []
    let enters: string[] = []
    let leaves: string[] = []

    function row(id: string): RemixNode {
      return jsx(Box, {
        id,
        mix: [
          style({ layout: { width: grow(), height: fixed(1) } }),
          on<TerminalBox>('pointerenter', (event) => {
            enters.push(event.id)
          }),
          on<TerminalBox>('pointerleave', (event) => {
            leaves.push(event.id)
          }),
          on<TerminalBox>('pointerclick', (event) => {
            clicks.push(event.id)
          }),
        ],
        children: jsx(Text, { children: id }),
      })
    }

    root.render(
      jsx(Box, {
        id: 'rows',
        mix: style({ layout: { width: fixed(6), height: fixed(2), direction: 'ttb' } }),
        children: [row('first'), row('second')],
      }),
    )

    root.writeInput(encoder.encode('\x1b[<0;1;1M'))
    root.writeInput(encoder.encode('\x1b[<0;1;1m'))
    assert.deepEqual(enters, ['first'])
    assert.deepEqual(clicks, ['first'])

    // Row 2 begins where row 1 ends, and that shared edge is inside both
    // boxes: only the row the cell actually belongs to may be hit.
    root.writeInput(encoder.encode('\x1b[<0;1;2M'))
    root.writeInput(encoder.encode('\x1b[<0;1;2m'))
    assert.deepEqual(clicks, ['first', 'second'])
    assert.deepEqual(enters, ['first', 'second'])
    assert.deepEqual(leaves, ['first'])

    root.unmount()
  })

  it('aborts a pointer handler signal on reentry and on unmount', async () => {
    let { root } = await session()
    let reasons: string[] = []
    let pending: AbortSignal | undefined

    root.render(
      jsx(Box, {
        mix: [
          style({ layout: { width: fixed(4), height: fixed(1) } }),
          on<TerminalBox>('pointerclick', (_event, signal) => {
            pending = signal
            signal.addEventListener('abort', () => {
              reasons.push((signal.reason as DOMException).name)
            })
          }),
        ],
        children: jsx(Text, { children: 'go' }),
      }),
    )

    root.writeInput(encoder.encode('\x1b[<0;1;1M'))
    root.writeInput(encoder.encode('\x1b[<0;1;1m'))
    assert.ok(pending !== undefined)
    assert.equal(pending.aborted, false)

    // A second click supersedes the first: the run in flight is cancelled
    // before the handler starts again.
    root.writeInput(encoder.encode('\x1b[<0;1;1M'))
    root.writeInput(encoder.encode('\x1b[<0;1;1m'))
    assert.deepEqual(reasons, ['EventReentry'])

    // Tearing down removes the listener and cancels the last run with it.
    root.unmount()
    assert.deepEqual(reasons, ['EventReentry', 'AbortError'])
  })

  it('stops a batch of input as soon as a listener unmounts', async () => {
    let { root, input, frames } = await session()

    root.render(jsx(Text, { children: 'keys' }))
    let painted = frames.length
    root.addEventListener('input', () => root.unmount())

    root.writeInput(encoder.encode('ab\x1b'))
    assert.equal(input.length, 1)

    await sleep(60)
    assert.equal(input.length, 1)
    assert.equal(frames.length, painted)
  })

  it('holds a lone escape byte until the parser latency elapses', async () => {
    let { root, input } = await session()

    root.render(jsx(Text, { children: 'keys' }))
    root.writeInput(new Uint8Array([0x1b]))
    assert.equal(input.length, 0)

    await sleep(60)
    assert.equal(input.length, 1)
    assert.partialDeepEqual(input, [{ type: 'keydown', key: 'Escape' }])

    root.unmount()
  })

  it('drops a pending escape and further input once unmounted', async () => {
    let { root, input } = await session()

    root.render(jsx(Text, { children: 'keys' }))
    root.writeInput(new Uint8Array([0x1b]))
    root.unmount()
    root.unmount()

    await sleep(60)
    root.writeInput(encoder.encode('x'))
    assert.deepEqual(input, [])
  })

  it('reports engine errors for duplicate element ids', async () => {
    let { root, errors } = await session()

    root.render([
      jsx(Box, { id: 'same', mix: style({ layout: { width: fixed(2), height: fixed(1) } }) }),
      jsx(Box, { id: 'same', mix: style({ layout: { width: fixed(2), height: fixed(1) } }) }),
    ])

    assert.equal(errors.length, 1)
    let error = errors[0]
    assert.ok(error instanceof TerminalRenderError)
    assert.equal(error.type, 'DUPLICATE_ID')

    root.unmount()
  })

  it('reports an element nested inside a text run', async () => {
    let { root, errors } = await session()

    root.render(jsx(Text, { children: jsx(Box, {}) }))

    assert.equal(errors.length, 1)
    let error = errors[0]
    assert.ok(error instanceof TerminalRenderError)
    assert.equal(error.type, 'UNSUPPORTED_NESTING')

    root.unmount()
  })

  it('reports a failed input driven redraw instead of throwing at the writer', async () => {
    let { root, errors, input } = await session()

    root.render(jsx(Text, { children: jsx(Box, {}) }))
    assert.equal(errors.length, 1)

    // The press redraws the same unrenderable tree. Its failure belongs to the
    // same error channel the commit used, and the batch keeps parsing.
    root.writeInput(encoder.encode('\x1b[<0;1;1Mx'))
    assert.equal(errors.length, 2)
    let error = errors[1]
    assert.ok(error instanceof TerminalRenderError)
    assert.equal(error.type, 'UNSUPPORTED_NESTING')
    assert.partialDeepEqual(input, [{ type: 'mousedown' }, { type: 'keydown', key: 'x' }])

    root.unmount()
  })
})
