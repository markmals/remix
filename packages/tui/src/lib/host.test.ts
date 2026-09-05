import { fixed, rgba } from '@bomb.sh/tty'
import * as assert from '@remix-run/assert'
import { describe, it } from '@remix-run/test'

import { BOX, createTerminalHost, TEXT } from './host.ts'

describe('createTerminalHost', () => {
  it('rejects props the terminal has no meaning for', () => {
    let host = createTerminalHost(() => {})

    assert.throws(() => host.createElement(BOX, { className: 'card' }), {
      name: 'TerminalRenderError',
      type: 'UNSUPPORTED_PROP',
    })
    // tty addresses boxes only, so a text run has no id to report.
    assert.throws(() => host.createElement(TEXT, { id: 'label' }), { type: 'UNSUPPORTED_PROP' })
    assert.throws(() => host.createElement(BOX, { id: '' }), { type: 'UNSUPPORTED_PROP' })
    assert.throws(() => host.createElement('div', {}), { type: 'UNSUPPORTED_ELEMENT' })
  })

  it('rejects style fields the element op cannot carry', () => {
    let host = createTerminalHost(() => {})

    // tty packs only the fields its own op declares, so a field meant for the
    // other one would vanish instead of failing.
    assert.throws(() => host.createElement(TEXT, { style: { layout: { width: fixed(2) } } }), {
      type: 'UNSUPPORTED_STYLE',
    })
    assert.throws(() => host.createElement(BOX, { style: { color: rgba(1, 2, 3) } }), {
      type: 'UNSUPPORTED_STYLE',
    })
    assert.throws(() => host.createElement(BOX, { style: 'bold' }), { type: 'UNSUPPORTED_STYLE' })
  })
})
