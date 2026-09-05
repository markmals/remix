import { createRoot } from 'remix/tui/node'

import { App } from './app.tsx'

const terminal = await createRoot()
try {
  terminal.render(<App terminal={terminal} />)
  await terminal.closed
} finally {
  terminal.unmount()
}
