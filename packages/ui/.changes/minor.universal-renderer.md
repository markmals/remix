BREAKING CHANGE: `createScheduler()` from `remix/ui` now returns the shared renderer scheduler. Replace `scheduler.dequeue()` with `scheduler.flush()`. Pass custom style managers through `createRoot()` or `createRangeRoot()` options instead of the removed third argument to `createScheduler()`.

Add the experimental `remix/ui/renderer` host-operation API, shared by the DOM renderer and custom backends such as `remix/tui`. Hosts provide node creation, composed-prop updates, insertion/removal, traversal, and optional commit and event-target hooks. One reconciliation engine manages component and mixin lifecycles, keyed identity, context, batched updates, post-commit tasks, and abort-signal cleanup.

The DOM host preserves frames, hydration, navigation, `innerHTML`, controlled inputs, and retained-node animations through optional host capabilities. Custom hosts can opt into hydration, Frame ranges, shared scheduling, and deferred removal with cross-root keyed reclamation. DOM-dependent mixins still require browser infrastructure. HTML stream serialization remains separate from mounted-tree reconciliation.

Custom renderer roots emit portable `RendererErrorEvent` objects built on `Event`, so error reporting works in runtimes without the browser `ErrorEvent` global, including Node 24. DOM root error events remain unchanged.

Range-root hydration keeps malformed Frame markers inside the root's boundary instead of adopting and later removing surrounding content.
