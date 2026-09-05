import { createTerm, fixed, type Op } from '@bomb.sh/tty'
import * as assert from '@remix-run/assert'
import { describe, it } from '@remix-run/test'

import { BOX, createTerminalHost, TEXT, TerminalBox } from './host.ts'
import { serialize } from './serialize.ts'

const decoder = new TextDecoder()

async function paint(container: TerminalBox): Promise<string> {
  let term = await createTerm({ width: 16, height: 2 })
  let ops: Op[] = []
  serialize(container, ops, new Map())
  return decoder.decode(term.render(ops).output)
}

describe('serialize', () => {
  it('emits the same frame with and without invisible anchors', async () => {
    let host = createTerminalHost(() => {})

    let plain = new TerminalBox('~root')
    let plainBox = host.createElement(BOX, { style: { layout: { height: fixed(1) } } })
    host.insert(plainBox, plain, null)
    host.insert(host.createText('ab'), plainBox, null)

    let anchored = new TerminalBox('~root')
    let anchoredBox = host.createElement(BOX, { style: { layout: { height: fixed(1) } } })
    host.insert(anchoredBox, anchored, null)
    host.insert(host.createComment('before'), anchoredBox, null)
    host.insert(host.createText('a'), anchoredBox, null)
    host.insert(host.createComment('between'), anchoredBox, null)
    host.insert(host.createText('b'), anchoredBox, null)
    host.insert(host.createComment('after'), anchoredBox, null)

    assert.equal(await paint(anchored), await paint(plain))
  })

  it('serializes text elements as a single run of their text children', async () => {
    let host = createTerminalHost(() => {})
    let container = new TerminalBox('~root')
    let text = host.createElement(TEXT, {})
    host.insert(text, container, null)
    host.insert(host.createText('one '), text, null)
    host.insert(host.createText('two'), text, null)

    assert.ok((await paint(container)).includes('one two'))
  })
})
