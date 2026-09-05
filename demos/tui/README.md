# Terminal Renderer Demo

A local task queue that exercises Remix's experimental universal renderer through `remix/tui`. It does not execute commands. Each task owns a run count in component setup scope, so reversing the keyed list demonstrates state staying with its task rather than its row position.

## Run

From this branch, install workspace dependencies, then start the demo in an interactive terminal:

```sh
pnpm install
pnpm -C demos/tui start
```

## Controls

- Up/Down or `k`/`j`: select a task
- Enter or Space: increment the selected task's local run count
- Click a task: select and increment it
- `r`: reverse the list without resetting task state
- `x`: remove the selected task and dispose its input listener
- `a`: add a new task with fresh state
- `q`, Escape, or Ctrl+C: quit and restore the terminal

Resize the terminal to exercise tty's layout and full redraw. At 40 columns by 16 rows, the initial queue and all keyboard controls remain visible.

`app.tsx` uses normal Remix component setup/render functions, context, `handle.update()`, `handle.signal`, `Box`, and `Text`. Layout and appearance use `mix={style(...)}` from `remix/tui`; pointer events compose with `on()` from `remix/ui`. `main.tsx` connects the Node terminal root and waits for its `closed` promise. The renderer backend uses `@bomb.sh/tty` for layout and input, not a DOM shim.

The DOM renderer has not been migrated to the experimental host interface. See the [renderer package](https://github.com/remix-run/remix/tree/main/packages/tui) for supported operations and boundaries.
