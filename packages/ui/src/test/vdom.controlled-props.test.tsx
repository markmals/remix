import { expect } from '@remix-run/assert'
import { describe, it } from '@remix-run/test'
import type { Handle } from '../runtime/component.ts'
import { createRoot, type VirtualRoot } from '../runtime/vdom.ts'
import { createMixin, on } from '../index.ts'

// Synthetic per-character `type` against an <input>. Mirrors what a real
// browser fires: keydown -> beforeinput -> input -> keyup, mutating the value
// at the cursor between beforeinput and input. When the cursor is still at the
// default 0/0 with a non-empty value we move it to the end first, so typing
// into a pre-filled controlled input appends rather than prepends.
async function type(field: HTMLInputElement, text: string): Promise<void> {
  field.focus()
  if (field.selectionStart === 0 && field.selectionEnd === 0 && field.value.length > 0) {
    field.setSelectionRange(field.value.length, field.value.length)
  }
  for (let char of text) {
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }),
    )
    let beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: char,
    })
    if (field.dispatchEvent(beforeInput)) {
      let start = field.selectionStart ?? field.value.length
      let end = field.selectionEnd ?? field.value.length
      field.value = field.value.slice(0, start) + char + field.value.slice(end)
      field.setSelectionRange(start + 1, start + 1)
      field.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }),
      )
    }
    field.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))
  }
  await Promise.resolve()
}

describe('vdom controlled props', () => {
  it('restores controlled value on native input when no update happens', async () => {
    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(<input value="hello" />)
    root.flush()

    let input = container.querySelector('input') as HTMLInputElement
    input.value = 'hello123'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(input.value).toBe('hello')
  })

  it('releases controlled value ownership when another root reclaims the input', async () => {
    let removal = Promise.withResolvers<void>()
    let persist = createMixin<HTMLInputElement>((handle) => {
      handle.addEventListener('beforeRemove', (event) => {
        event.persistNode(() => removal.promise)
      })
    })
    let container = document.createElement('div')
    let first = createRoot(container)
    let second: VirtualRoot | undefined

    try {
      first.render(<input key="field" value="controlled" mix={persist()} />)
      let input = container.querySelector('input')
      if (!input) throw new Error('Expected an input')
      first.dispose()

      second = createRoot(container)
      second.render(<input key="field" mix={persist()} />)
      expect(container.querySelector('input')).toBe(input)

      input.value = 'editable'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
      expect(input.value).toBe('editable')
    } finally {
      first.dispose()
      second?.dispose()
      removal.resolve()
    }
  })

  it('resolves a controlled select value against reclaimed children', () => {
    let releaseRemoval: (() => void) | null = null
    let persist = createMixin<HTMLSelectElement>((handle) => {
      handle.addEventListener('beforeRemove', (event) => {
        event.persistNode(
          () =>
            new Promise<void>((resolve) => {
              releaseRemoval = () => resolve()
            }),
        )
      })
    })
    let container = document.createElement('div')
    let root = createRoot(container)

    try {
      root.render(
        <select key="picker" value="a" mix={persist()}>
          <option value="a">A</option>
          <option value="b">B</option>
        </select>,
      )
      root.flush()

      let select = container.querySelector('select')
      if (!select) throw new Error('Expected a select')
      expect(select.value).toBe('a')

      root.render(null)
      root.flush()
      expect(container.querySelector('select')).toBe(select)

      // The value prop can only select an option that exists, so reclaim has to
      // diff the retained children before it applies props and finalizes.
      root.render(
        <select key="picker" value="d" mix={persist()}>
          <option value="c">C</option>
          <option value="d">D</option>
        </select>,
      )
      root.flush()

      expect(container.querySelector('select')).toBe(select)
      expect(select.value).toBe('d')
    } finally {
      let release = releaseRemoval ?? (() => {})
      release()
      root.dispose()
    }
  })

  it('restores controlled checked on native change when no update happens', async () => {
    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(<input type="checkbox" checked={true} />)
    root.flush()

    let input = container.querySelector('input') as HTMLInputElement
    input.checked = false
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(input.checked).toBe(true)
  })

  it('allows controlled value changes when an input event calls handle.update()', () => {
    function App(handle: Handle) {
      let value = 'hello'
      let renderCount = 0

      function rerender() {
        renderCount++
        handle.update()
      }

      return () => (
        <>
          <input
            value={value}
            mix={[
              on('input', (event) => {
                let nextValue = event.currentTarget.value
                if (/\d/.test(nextValue)) return
                value = nextValue
                rerender()
              }),
            ]}
          />
          <output>{`${renderCount}:${value}`}</output>
        </>
      )
    }

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(<App />)
    root.flush()

    let input = container.querySelector('input') as HTMLInputElement
    let output = container.querySelector('output') as HTMLOutputElement

    input.value = 'helloa'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    root.flush()

    expect(input.value).toBe('helloa')
    expect(output.textContent).toBe('1:helloa')
  })

  it('preserves controlled updates from real typing while rejecting invalid input', async () => {
    function App(handle: Handle) {
      let value = 'hello'
      let renderCount = 0

      function rerender() {
        renderCount++
        handle.update()
      }

      return () => (
        <>
          <label htmlFor="tracked">Tracked</label>
          <input
            id="tracked"
            value={value}
            mix={[
              on('input', (event) => {
                let nextValue = event.currentTarget.value
                if (/\d/.test(nextValue)) return
                value = nextValue
                rerender()
              }),
            ]}
          />
          <output>{`${renderCount}:${value}`}</output>
        </>
      )
    }

    let container = document.createElement('div')
    document.body.appendChild(container)
    let root = createRoot(container)
    root.render(<App />)
    root.flush()

    let input = container.querySelector('input') as HTMLInputElement
    let output = container.querySelector('output') as HTMLOutputElement

    await type(input, 'a')
    root.flush()
    expect(input.value).toBe('helloa')
    expect(output.textContent).toBe('1:helloa')

    await type(input, '1')
    await Promise.resolve()
    await Promise.resolve()
    expect(input.value).toBe('helloa')
    expect(output.textContent).toBe('1:helloa')

    await type(input, 'b')
    root.flush()
    expect(input.value).toBe('helloab')
    expect(output.textContent).toBe('2:helloab')

    container.remove()
  })

  it('does not clobber controlled value when input event commits a new value', async () => {
    function App(handle: Handle) {
      let value = 'hello'
      return () => (
        <input
          value={value}
          mix={[
            on('input', (event) => {
              value = event.currentTarget.value
              handle.update()
            }),
          ]}
        />
      )
    }

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(<App />)
    root.flush()

    let input = container.querySelector('input') as HTMLInputElement
    input.value = 'helloa'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(input.value).toBe('helloa')
  })

  it('does not control value/checked when prop value is undefined', async () => {
    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(
      <>
        <input id="text" value={undefined} />
        <input id="check" type="checkbox" checked={undefined} />
      </>,
    )
    root.flush()

    let text = container.querySelector('#text') as HTMLInputElement
    text.value = 'user typed'
    text.dispatchEvent(new Event('input', { bubbles: true }))

    let check = container.querySelector('#check') as HTMLInputElement
    check.checked = true
    check.dispatchEvent(new Event('change', { bubbles: true }))

    await Promise.resolve()
    await Promise.resolve()
    expect(text.value).toBe('user typed')
    expect(check.checked).toBe(true)
  })

  it('reflects a controlled select value after mounting and replacing options', () => {
    let container = document.createElement('div')
    let root = createRoot(container)
    try {
      root.render(
        <select value="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </select>,
      )
      let select = container.querySelector('select')
      if (!select) throw new Error('Expected a select')
      expect(select.value).toBe('b')

      root.render(
        <select value="b">
          <option value="b">B</option>
          <option value="a">A</option>
        </select>,
      )
      expect(select.value).toBe('b')
    } finally {
      root.dispose()
    }
  })

  it('restores controlled value on native change for select when no update happens', async () => {
    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(
      <select value="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>,
    )
    root.flush()

    let select = container.querySelector('select') as HTMLSelectElement
    select.value = 'a'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    await Promise.resolve()
    await Promise.resolve()
    expect(select.value).toBe('b')
  })

  it('applies next select value from change handlers after prior input event', async () => {
    function App(handle: Handle) {
      let value = 'alpha'
      return () => (
        <>
          <select
            value={value}
            mix={[
              on('change', (event) => {
                value = event.currentTarget.value
                handle.update()
              }),
            ]}
          >
            <option value="alpha">Alpha</option>
            <option value="beta">Beta</option>
            <option value="gamma">Gamma</option>
          </select>
          <output>{value}</output>
        </>
      )
    }

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(<App />)
    root.flush()

    let select = container.querySelector('select') as HTMLSelectElement
    let output = container.querySelector('output') as HTMLOutputElement

    select.value = 'beta'
    select.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    select.dispatchEvent(new Event('change', { bubbles: true }))
    root.flush()

    expect(select.value).toBe('beta')
    expect(output.textContent).toBe('beta')
  })

  it('detaches controlled listeners on dispose', async () => {
    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(<input value="hello" />)
    root.flush()

    let input = container.querySelector('input') as HTMLInputElement
    root.dispose()
    root.flush()

    input.value = 'post-dispose'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(input.value).toBe('post-dispose')
  })
})
