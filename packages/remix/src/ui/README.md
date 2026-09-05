# ui

Runtime UI primitives for Remix apps, including the component runtime, server rendering, frame hydration, reusable mixins, and headless first-party behavior primitives.

## Features

- Component runtime APIs for rendering, hydration, link and form frame navigation, and JSX
- Server rendering APIs for streaming Remix UI trees and frames
- `mix` composition with event, ref, CSS, and animation helpers
- Headless behavior primitives for controls such as menus, listboxes, popovers, selects, and comboboxes
- Lower-level utilities for keyboard events, typeahead search, refs, attributes, and CSS transition timing
- Experimental host-operation API shared by the DOM renderer and custom renderers

## Installation

```sh
npm i remix
```

## Usage

Compose behavior primitives with your own markup and styles:

```tsx
import { css } from 'remix/ui'
import * as popover from 'remix/ui/popover'

let triggerCss = css({
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  padding: '6px 10px',
})

let surfaceCss = css({
  background: 'white',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  padding: '8px',
})

function ViewOptions() {
  let open = false

  return () => (
    <popover.Context>
      <button
        mix={[triggerCss, popover.anchor({ placement: 'bottom-end' }), popover.focusOnHide()]}
        onClick={() => {
          open = true
        }}
        type="button"
      >
        View options
      </button>
      <div
        mix={[
          surfaceCss,
          popover.surface({
            open,
            onHide() {
              open = false
            },
          }),
        ]}
      >
        Panel content
      </div>
    </popover.Context>
  )
}
```

Button styling is available as a composable mixin:

```tsx
import button from 'remix/ui/button'

function Actions() {
  return () => <button mix={button({ tone: 'primary' })}>Create project</button>
}
```

## Custom Renderers

`remix/ui/renderer` exposes an experimental `createRenderer(host)` API used by the DOM renderer and by out-of-tree backends. Its Vue-style host interface lets Remix own component setup, stable props, context, mixin composition, keyed identity, batched updates, and lifetime cleanup while the host owns its node tree.

Given a host implementation and its container:

```tsx
import { createRenderer } from 'remix/ui/renderer'

let renderer = createRenderer(host)
let root = renderer.createRoot(container)
root.render(<App />)
root.flush()
root.unmount()
```

Implement these operations on `RendererHost<node, element, container>`. The container type defaults to `element`:

| Operation                                         | Contract                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `createElement(type, props, parent)`              | Create an element with initial composed props; use the parent for document or namespace context |
| `createText(text, parent)`, `setText(node, text)` | Create and update host text                                                                     |
| `createComment(text, parent)`                     | Create an invisible, insertable replacement anchor                                              |
| `patchProps(element, previous, next)`             | Diff complete composed prop bags, including removed props                                       |
| `insert(node, parent, before)`                    | Insert or move a node; `null` appends                                                           |
| `remove(node)`                                    | Detach a subtree; descendants are cleaned up without separate host removals                     |
| `parentNode(node)`, `nextSibling(node)`           | Traverse the host tree                                                                          |
| `getEventTarget(element)` (optional)              | Expose an `EventTarget` for the shared mixin lifecycle; required on elements using `mix`        |
| `commit(container)` (optional)                    | Paint once per batch, after mutations and before component tasks                                |

Roots append to their container and remove only their own nodes. `handle.update()` schedules a component update; `flush()` drains pending work immediately outside a render. Nested renders on a shared scheduler join the enclosing batch, so commits and component tasks wait until the outer render finishes. Unmounting aborts component signals and settles pending updates.

Custom hosts use the normal `mix` prop and `createMixin` API. Mixins compose props in order and share context, updates, tasks, and abort-signal cleanup with DOM mixins. `on()` works with a host's event target, and a backend can ship mixin factories of its own the way `@pitlane/tui` provides `style()` for terminal appearance and layout. Hosts receive borrowed composed prop bags: ignore the renderer-owned `children`, `mix`, and `key` fields, and never retain or mutate the bags.

Reconciliation failures from `render()` throw synchronously. Scheduled update, queued-task, and commit failures emit a cancelable `RendererErrorEvent`: a standard `Event` with an `error` payload, not a browser-only `ErrorEvent`. Call `preventDefault()` when handling `event.error`, or the error is rethrown asynchronously.

Reconciliation is not transactional: host mutations made before a failure are not rolled back. Unmount and recreate a failed root when a clean recovery is required.

The terminal renderer lives outside this repo: [`@pitlane/tui`](https://github.com/pitlane-tools/pitlane/tree/main/packages/tui) implements this interface using `@bomb.sh/tty`. Its [host operations](https://github.com/pitlane-tools/pitlane/blob/main/packages/tui/src/lib/host.ts) and [interactive demo](https://github.com/pitlane-tools/pitlane/tree/main/demos/tui) provide a working non-DOM example, and its guides cover [terminal applications](https://github.com/pitlane-tools/pitlane/blob/main/docs/guides/terminal-applications.md) and [embedding terminal renderers](https://github.com/pitlane-tools/pitlane/blob/main/docs/guides/embedding-terminal-renderers.md).

The DOM renderer implements the same interface, with optional capabilities for hydration, Frame ranges, `innerHTML`, shared document-head ownership, and controlled-property reflection. `createRendererPersistence()` provides a deferred-removal scope that compatible hosts can share for keyed reclamation across roots. `createRendererScheduler()` lets roots share batches and before-mutation/before-commit hooks. See the [host contract](https://github.com/remix-run/remix/blob/main/packages/ui/src/runtime/universal/host.ts) for these integration points.

Hosts without the corresponding capability reject `Frame` and `innerHTML`. Mixins that require browser frame/style infrastructure, including `css()`, remain DOM-only. HTML stream serialization and streamed-HTML synchronization remain separate from mounted-tree reconciliation.

## Frame Navigation

Calling `run()` starts both hydration and frame navigation. It represents the current document as
`app.frames.top` and intercepts eligible same-origin links and forms through the browser's
Navigation API. Those navigations fetch HTML with the frame resolver and update the existing
document in place instead of loading a new document:

```tsx
import { run } from 'remix/ui'

let app = run({
  async loadModule(moduleUrl, exportName) {
    let mod = await import(moduleUrl)
    return mod[exportName]
  },
})

await app.ready()
```

This soft-navigation behavior applies even when the page only uses `clientEntry()` and does not
render an explicit `<Frame>`.

The default resolver is equivalent to:

```js
async function resolveFrame(src, options) {
  let response = await fetch(src, {
    body: getRequestBody(options),
    headers: { Accept: 'text/html' },
    method: options?.method,
    signal: options?.signal,
  })

  if (!response.ok) {
    throw new Error(`Failed to resolve frame: ${response.status} ${response.statusText}`.trimEnd())
  }

  return response
}

function getRequestBody(options) {
  let formData = options?.formData
  if (!formData || options?.method?.toLowerCase() === 'get') return

  if (options?.encType === 'text/plain') {
    let body = ''
    for (let [name, value] of formData) {
      name = normalizeLineBreaks(name)
      value = normalizeLineBreaks(typeof value === 'string' ? value : value.name)
      body += `${name}=${value}\r\n`
    }
    return new Blob([body], { type: 'text/plain' })
  }

  if (options?.encType !== 'application/x-www-form-urlencoded') return formData

  let body = new URLSearchParams()
  for (let [name, value] of formData) {
    body.append(name, typeof value === 'string' ? value : value.name)
  }
  return body
}

function normalizeLineBreaks(value) {
  return value.replace(/\r\n|\r|\n/g, '\r\n')
}
```

The default resolver requests HTML. GET form values are already encoded in `src`;
`application/x-www-form-urlencoded` submissions use `URLSearchParams`, `text/plain` submissions use
CRLF-delimited text, and `multipart/form-data` submissions use `FormData`. Pass a custom
`resolveFrame` when the server requires additional headers, another body encoding, or a different
response policy.

Add `data-rmx-document` to a link or form to leave that navigation to the browser. To keep all links
and forms as document navigations while still hydrating client entries and using explicit frames,
register a listener before calling `run()`:

```ts
window.navigation?.addEventListener('navigate', (e) => e.stopImmediatePropagation())
```

This prevents Remix from intercepting Navigation API events. Explicit frame reloads such as
`handle.frame.reload()` continue to use the frame resolver.

The default resolver rejects non-OK responses with an error containing their status and status text.
A custom `resolveFrame` may return a `Response` with any status when it wants Remix UI to render the
response body.

Forms remain ordinary HTML forms before the runtime starts. Add `data-rmx-target` to reload a named frame, or `data-rmx-document` to require a full-document submission:

```tsx
import { Frame } from 'remix/ui'

function AccountPage() {
  return () => (
    <>
      <Frame name="account" src="/account/edit" />
      <form action="/account/edit" method="post" data-rmx-target="account">
        <label for="display-name">Display name</label>
        <input id="display-name" name="displayName" required />
        <button type="submit">Save</button>
      </form>
    </>
  )
}
```

Native constraint validation and submitter overrides still apply. GET form values arrive in `src`; non-GET forms provide `formData`, `method`, and `encType` to the resolver. See [Frames](https://github.com/remix-run/remix/blob/main/packages/ui/docs/frames.md#form-navigation) for targeting, history behavior, request encoding, opt-outs, and server response guidance.

Use `data-rmx-history="push|replace"` on an enhanced anchor or form to control how the navigation updates history. This can override the automatic replacement used for non-GET form submissions to the current URL.

## Single-page Applications

Use `render` and `run` from `remix/spa` when every route runs in the browser and returns a Remix UI
tree instead of an HTTP response body. The render middleware keeps the router's standard `Request`
to `Response` contract while associating the response with a node for the top frame to render:

```tsx
import { createRouter } from 'remix/router'
import { render, run } from 'remix/spa'

let router = createRouter({ middleware: [render()] })

router.get('/', ({ render }) => render(<h1>Home</h1>))
router.get('/about', ({ render }) => render(<h1>About</h1>))

function LoadingPage() {
  return () => <p role="status">Loading…</p>
}

let app = run(router, { fallback: <LoadingPage /> })
await app.ready()
```

The optional `fallback` is a live Remix node displayed while the initial route loads.
`app.ready()` resolves after the initial URL has replaced it with the routed node. The runtime then
reuses frame navigation for same-origin links, forms, history traversal, redirects, cancellation,
and `rmx-target`.

## Preserving Client-Owned DOM

Use `data-rmx-preserve-dom` on the smallest element whose live DOM should belong to client code after initial render, such as a custom element or third-party widget:

```tsx
<pagefind-ui data-rmx-key="search" data-rmx-preserve-dom>
  <button type="button">Search</button>
</pagefind-ui>
```

Remix UI still renders the element's children during SSR and still hydrates any initial client entries inside it. On later frame reloads, matched `data-rmx-preserve-dom` elements keep their current attributes and children instead of accepting incoming DOM updates. See [Preserving client-owned DOM](https://github.com/remix-run/remix/blob/main/packages/ui/docs/frames.md#preserving-client-owned-dom) for guidance and caveats.

## Cascade Layers

Remix UI emits generated `css(...)` rules under the `rmx` cascade layer. Unlayered CSS outranks layered CSS, so use explicit layer order when mixing Remix UI with global styles.

Put layers that should lose to Remix UI before `rmx`:

```css
@layer base, rmx;

@layer base {
  button,
  input,
  textarea,
  select {
    font: inherit;
    margin: 0;
    padding: 0;
  }
}
```

## License

See [LICENSE](https://github.com/remix-run/remix/blob/main/LICENSE)
