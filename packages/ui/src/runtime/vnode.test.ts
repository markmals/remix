import * as assert from '@remix-run/assert'
import { describe, it } from '@remix-run/test'

import { jsx } from './jsx.ts'
import { toVNode } from './to-vnode.ts'
describe('VNode validation', () => {
  it('validates framework props at the element boundary', () => {
    assert.throws(() => toVNode(jsx('div', { innerHTML: 42 })), /Invalid innerHTML prop/)
    assert.throws(() => toVNode(jsx('div', { mix: {} })), /Invalid mix prop/)
  })
})
