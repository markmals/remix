# tui

Render Remix UI components in a terminal using [@bomb.sh/tty](https://github.com/bombshell-dev/tty) for layout, input parsing, and cell-diffed output. This is an experimental renderer on this branch, not a replacement for the DOM renderer.

## Features

- Remix component setup, stable props, context, update batching, and abort-signal cleanup
- `Box` layout and `Text` content, with keyed component identity across reordering
- Composable style and event mixins, parsed keyboard input, resizing, and tty transitions
- A zero-I/O renderer for embedding, plus a Node runner that manages terminal modes

## Installation

```sh
npm i remix
```

The `remix/tui` entrypoints are available on this experimental branch, not in existing published Remix releases. If you import tty helpers such as `grow`, `fixed`, or `rgba` in your app, also install `@bomb.sh/tty@0.9.0` directly.

## Usage

The Node runner requires interactive stdin and stdout. It enters the alternate screen, enables raw input and mouse reporting, and restores terminal state on `unmount()`, Ctrl+C, SIGINT, SIGTERM, or input EOF.

```tsx
import { Box, Text, style } from 'remix/tui'
import type { TerminalRoot } from 'remix/tui'
import { createRoot } from 'remix/tui/node'
import { on } from 'remix/ui'
import type { Handle } from 'remix/ui'

function Counter(handle: Handle<{ terminal: TerminalRoot }>) {
  let count = 0

  function increment() {
    count++
    handle.update()
  }

  handle.props.terminal.addEventListener(
    'input',
    (event) => {
      if (event.detail.type === 'keydown' && event.detail.code === 'Enter') increment()
    },
    { signal: handle.signal },
  )

  return () => (
    <Box mix={[style({ layout: { direction: 'ttb' } }), on('pointerclick', increment)]}>
      <Text>Count: {count}</Text>
      <Text>Enter or click to increment. Ctrl+C to quit.</Text>
    </Box>
  )
}

const terminal = await createRoot()
try {
  terminal.render(<Counter terminal={terminal} />)
  await terminal.closed
} finally {
  terminal.unmount()
}
```

Use the normal `remix/ui` JSX runtime (`jsx: "react-jsx"`, `jsxImportSource: "remix/ui"`). Run TSX on Node with `node --import remix/node-tsx app.tsx`.

The [interactive demo](https://github.com/remix-run/remix/tree/main/demos/tui) exercises context, local component state, keyed reordering, removal, input cleanup, pointer clicks, and resizing:

```sh
pnpm -C demos/tui start
```

## Layout and Text

Use `style()` in the `mix` prop for terminal layout and appearance, just as you use `css()` for DOM elements. Import sizing and color helpers from their owning package:

```tsx
import { grow, rgba } from '@bomb.sh/tty'
import { Box, Text, style } from 'remix/tui'
;<Box
  mix={style({
    bg: rgba(20, 25, 32),
    layout: { width: grow(), height: grow(), direction: 'ttb' },
  })}
>
  <Text mix={style({ color: rgba(232, 237, 242) })}>Ready</Text>
</Box>
```

`style()` is a Remix mixin built with `createMixin`, not a separate styling system. Compose it with other mixins in an array. Later styles override earlier styles at the top level; a later `layout` replaces the earlier `layout` object. Reusable descriptors and conditional entries follow the normal `mix` conventions:

```tsx
let row = style({ layout: { width: grow(), direction: 'ltr' } })
let selected = true

;<Box mix={[row, selected && style({ bg: rgba(37, 65, 88) })]}>
  <Text>Selected task</Text>
</Box>
```

Wrap a full-screen app in a growing `Box`. The renderer does not add a layout box around your tree. `Text` combines primitive children, fragments, and component output into one styled text run. Nesting a `Box` or another `Text` inside `Text` is unsupported and reports an error; put separately styled runs in a surrounding `Box`.

Use `on('pointerenter', handler)`, `on('pointerleave', handler)`, and `on('pointerclick', handler)` from `remix/ui` on a `Box`. Handlers receive a typed event with the box's `id` and an `AbortSignal` that is aborted on repeated dispatch or removal. A click requires a press and release over the box. tty also reports containing ancestor boxes, so their listeners may run too; these are separate events, not DOM bubbling. Box ids are generated per host instance; an explicit `id` must be unique in the frame. `Text` is a text run, not an independent pointer target.

## Embedding Without Node I/O

`remix/tui` never reads stdin, writes stdout, or changes terminal modes. Supply dimensions and consume its output bytes, then feed it input and resize notifications from your environment:

```tsx
import { createRoot, Text } from 'remix/tui'

let frames: Uint8Array[] = []
let root = await createRoot({
  width: 80,
  height: 24,
  write(bytes) {
    frames.push(bytes.slice())
  },
})
root.addEventListener('input', (event) => {
  if (event.detail.type === 'keydown') {
    root.render(<Text>Last key: {event.detail.key}</Text>)
  }
})
root.render(<Text>Press a key</Text>)
root.writeInput(new TextEncoder().encode('a'))
root.resize(100, 30)
root.unmount()
```

The output is an ephemeral WASM memory view. Consume or copy it before `write` returns; retaining it for an asynchronous write without copying corrupts output. The Node runner handles this copy. Identical frames emit no output.

`handle.update()` schedules a microtask-batched component update. `root.flush()` drains queued work synchronously. `root.unmount()` aborts component signals and stops input/animation timers; the zero-I/O root leaves the last screen intact. The Node root additionally restores terminal modes and settles `closed`.

## Errors and Experimental Boundaries

Reconciliation errors from `render()` throw synchronously. Scheduled component errors, queued-task errors, and paint/commit errors emit a cancelable `error` event. On the zero-I/O root, call `event.preventDefault()` when handling `event.error`; otherwise it is rethrown asynchronously. The Node runner treats these errors as fatal: it restores the terminal and rejects `closed`, even if an application listener also calls `preventDefault()`. tty errors use `TerminalRenderError`, whose `type` identifies the failure.

Reconciliation does not roll back host mutations after a failure. For clean recovery on a zero-I/O root, unmount it and create a replacement root.

This experiment does not implement DOM elements, CSS, DOM-dependent mixins, `innerHTML`, hydration, frames, or navigation. `Box` and `Text` are terminal-specific; `style()` and `on()` use the shared Remix mixin lifecycle. tty 0.9.0 does not expose a scroll-update API: wheel events are forwarded as input, but this package does not implement scrolling or a focus/widget system. Hover depends on the terminal sending mouse-motion reports.

## Related Packages

- [ui](https://github.com/remix-run/remix/tree/main/packages/ui) — component lifecycle and universal renderer host API
- [terminal](https://github.com/remix-run/remix/tree/main/packages/terminal) — ANSI styles and terminal output utilities without a UI tree
- [node-tsx](https://github.com/remix-run/remix/tree/main/packages/node-tsx) — TSX loading on Node

## Related Work

- [@bomb.sh/tty](https://github.com/bombshell-dev/tty) — terminal layout, input parser, and WASM rendering engine
- [Vue custom renderers](https://vuejs.org/api/custom-renderer.html) — host-operation API precedent

## License

See [LICENSE](https://github.com/remix-run/remix/blob/main/LICENSE)
