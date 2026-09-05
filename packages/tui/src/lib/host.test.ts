import { fixed, rgba } from '@bomb.sh/tty'
import * as assert from '@remix-run/assert'
import { describe, it } from '@remix-run/test'

import { BOX, createTerminalHost, TEXT, TerminalBox } from './host.ts'

describe('createTerminalHost', () => {
  it('rejects props the terminal has no meaning for', () => {
    let host = createTerminalHost(() => {})
    let container = new TerminalBox('root')

    assert.throws(() => host.createElement(BOX, { className: 'card' }, container), {
      name: 'TerminalRenderError',
      type: 'UNSUPPORTED_PROP',
    })
    // tty addresses boxes only, so a text run has no id to report.
    assert.throws(() => host.createElement(TEXT, { id: 'label' }, container), {
      type: 'UNSUPPORTED_PROP',
    })
    assert.throws(() => host.createElement(BOX, { id: '' }, container), {
      type: 'UNSUPPORTED_PROP',
    })
    assert.throws(() => host.createElement('div', {}, container), { type: 'UNSUPPORTED_ELEMENT' })
  })

  it('rejects style fields the element op cannot carry', () => {
    let host = createTerminalHost(() => {})
    let container = new TerminalBox('root')

    // tty packs only the fields its own op declares, so a field meant for the
    // other one would vanish instead of failing.
    assert.throws(
      () => host.createElement(TEXT, { style: { layout: { width: fixed(2) } } }, container),
      {
        type: 'UNSUPPORTED_STYLE',
      },
    )
    assert.throws(() => host.createElement(BOX, { style: { color: rgba(1, 2, 3) } }, container), {
      type: 'UNSUPPORTED_STYLE',
    })
    assert.throws(() => host.createElement(BOX, { style: 'bold' }, container), {
      type: 'UNSUPPORTED_STYLE',
    })
  })
})
