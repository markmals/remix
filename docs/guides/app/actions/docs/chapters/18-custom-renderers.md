---
title: Custom Renderers
description: Implement a non-DOM renderer host with remix/ui/renderer and render a Remix component tree into your own node graph.
---

`remix/ui/renderer` lets you render Remix components without a browser document. You provide operations over your own node graph: create elements and text, patch props, insert, remove, and read parent and sibling links. Remix keeps component setup and render, stable props, context, mixin composition, keyed identity, batched updates, and lifetimes.

This chapter builds one of those hosts. We keep an in-memory document that can print itself as indented text and as JSON, render the album list into it, press an album, reverse the list, remove a row, and read the exact host calls Remix made at each step. The host is about 120 lines of ordinary TypeScript and runs under `node` with no DOM shim.

Two Remix features share the word "renderer". `renderWith()`, in [Advanced Guides](/advanced-guides/#custom-renderers), installs request-scoped renderers that turn a value into an HTTP response. This chapter is the other one: where a mounted component tree puts its nodes.

## Get a build that has the renderer

This chapter requires a Remix checkout that includes the experimental `remix/ui/renderer` export. We'll use that workspace copy rather than a published npm release. The [terminal demo](https://github.com/remix-run/remix/tree/main/demos/tui) uses the same setup with a terminal backend.

A custom host gets the shared component runtime:

- setup and render phases, `handle.props`, `handle.context`, `handle.update()`, `handle.queueTask()`, and `handle.signal`
- keyed child matching, fragments, and multi-node component ranges
- the `mix` prop, `createMixin()`, and `on()` bound to your own event target
- batched updates with one host commit per batch

The DOM runtime keeps the rest. `<Frame />` throws `Frames are not supported by this renderer host`, `innerHTML` is rejected, `css()` is DOM-only, and hydration, navigation, retained-node animations, and DOM-specific controls stay in the browser runtime. The DOM reconciler has not been migrated to this interface either. The two renderers share the component and mixin lifecycles and the keyed matching code, not the reconciler.

## Create the project

Inside the checkout, add a workspace package beside the other demos:

```sh
mkdir demos/doc-renderer
```

```json filename=demos/doc-renderer/package.json
{
  "name": "doc-renderer",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.3.0"
  },
  "dependencies": {
    "remix": "workspace:^"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "@typescript/native-preview": "catalog:"
  },
  "scripts": {
    "start": "node --import remix/node-tsx main.tsx",
    "typecheck": "tsgo --noEmit"
  }
}
```

```json filename=demos/doc-renderer/tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "types": ["node"],
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ESNext",
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "jsxImportSource": "remix/ui"
  }
}
```

`jsxImportSource` points JSX at Remix's runtime, and `node --import remix/node-tsx` runs the TypeScript and JSX files directly, so there is no build step between editing and running. `lib` includes `DOM` because Remix's JSX types describe the HTML, SVG, and MathML intrinsics with DOM interfaces. Those are type declarations. Nothing in this project calls a DOM API at runtime.

Install so that `remix` and the catalog devDependencies resolve:

```sh
pnpm install
```

## Model the node graph

`RendererHost<node, element>` takes two type parameters. `node` is anything the tree can hold, `element` is the subset that can carry props and children, and `element extends node`. Our document has three kinds of node and one of them is an element.

```ts filename=demos/doc-renderer/doc-tree.ts
import { TypedEventTarget } from "remix/ui";

/**
 * Events a `DocElement` dispatches. `on()` reads its handler types from this
 * map, the same way it reads `HTMLElementEventMap` for a DOM element.
 */
export type DocElementEventMap = {
  "doc:press": Event;
};

/** An element: a tag, its props, its children, and a link to its parent. */
export class DocElement extends TypedEventTarget<DocElementEventMap> {
  readonly kind = "element";
  readonly type: string;
  props: Record<string, unknown> = {};
  children: DocNode[] = [];
  parent: DocElement | null = null;

  constructor(type: string) {
    super();
    this.type = type;
  }
}

/** A rendered string. */
export type DocText = {
  kind: "text";
  text: string;
  parent: DocElement | null;
};

/** An inert marker the renderer inserts to hold a position. */
export type DocAnchor = {
  kind: "anchor";
  label: string;
  parent: DocElement | null;
};

/** Every node this host can create. */
export type DocNode = DocElement | DocText | DocAnchor;

/** Plain-object form of the tree. */
export type DocJson =
  | string
  | { type: string; props: Record<string, unknown>; children: DocJson[] };

/** Detaches a node from its parent, if it has one. */
export function detach(node: DocNode): void {
  let parent = node.parent;
  if (parent === null) return;
  let index = parent.children.indexOf(node);
  if (index !== -1) parent.children.splice(index, 1);
  node.parent = null;
}

/** Short label for a node, used in the operation log. */
export function describe(node: DocNode): string {
  if (node.kind === "text") return show(node.text);
  if (node.kind === "anchor") return `[${node.label}]`;
  let title = node.props.title;
  return typeof title === "string" ? `<${node.type} ${title}>` : `<${node.type}>`;
}

/** Indented text snapshot of a list of nodes. */
export function formatTree(nodes: DocNode[]): string {
  let lines: string[] = [];
  for (let node of nodes) formatNode(node, 0, lines);
  return lines.join("\n");
}

/** Plain-object snapshot of a list of nodes, with anchors dropped. */
export function toJson(nodes: DocNode[]): DocJson[] {
  return nodes.map(jsonNode).filter(isPresent);
}

/** Every element of `type` below `root`, in document order. */
export function queryAll(root: DocElement, type: string): DocElement[] {
  let found: DocElement[] = [];
  for (let child of root.children) {
    if (child.kind !== "element") continue;
    if (child.type === type) found.push(child);
    found.push(...queryAll(child, type));
  }
  return found;
}

/** Renders a prop value for the log and the text snapshot. */
export function show(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function formatNode(node: DocNode, depth: number, lines: string[]): void {
  let indent = "  ".repeat(depth);
  if (node.kind === "text") {
    lines.push(`${indent}${node.text}`);
    return;
  }
  if (node.kind === "anchor") {
    lines.push(`${indent}[${node.label}]`);
    return;
  }
  let props = Object.keys(node.props)
    .sort()
    .map((name) => ` ${name}=${show(node.props[name])}`)
    .join("");
  lines.push(`${indent}<${node.type}${props}>`);
  for (let child of node.children) formatNode(child, depth + 1, lines);
}

function jsonNode(node: DocNode): DocJson | null {
  if (node.kind === "text") return node.text;
  if (node.kind === "anchor") return null;
  return {
    type: node.type,
    props: { ...node.props },
    children: node.children.map(jsonNode).filter(isPresent),
  };
}

function isPresent(value: DocJson | null): value is DocJson {
  return value !== null;
}
```

Three things in that file are there for the renderer rather than for the output.

Every node carries a `parent` link. The renderer keeps no index of its own: it asks the host where a node currently sits, which is also what lets a container hold nodes the renderer never created. Elements own their `props` and `children`, and the renderer treats both as write-only from its side.

`DocAnchor` is what `createComment` returns. It has no output of its own on purpose. The renderer inserts one when a node has to be replaced by a node of a different type, so the replacement lands exactly where the old node was, and it removes it inside the same batch. You will see one in the failed render at the end of this chapter.

`DocElement` extends `TypedEventTarget<DocElementEventMap>`, so an element is its own event target. That is what the `mix` prop binds to, and the event map is what types `on("doc:press", ...)` down in the components.

## Implement the operations

The host is the operations plus the container they mutate. This one also records every mutating call, which is the evidence for the rest of the chapter.

```ts filename=demos/doc-renderer/doc-host.ts
import type { RendererHost } from "remix/ui/renderer";

import {
  DocElement,
  describe,
  detach,
  formatTree,
  show,
  toJson,
  type DocJson,
  type DocNode,
} from "./doc-tree.ts";

export type DocDocument = {
  /** Element that renderer roots render into. */
  container: DocElement;
  /** Host operations the renderer calls. */
  host: RendererHost<DocNode, DocElement>;
  /** Mutating host calls since the last `takeOps()`, in call order. */
  takeOps(): string[];
  /** Indented text snapshot of the container's children. */
  format(): string;
  /** Plain-object snapshot of the container's children. */
  toJSON(): DocJson[];
};

export function createDocument(): DocDocument {
  let container = new DocElement("library-root");
  let ops: string[] = [];

  let host: RendererHost<DocNode, DocElement> = {
    createElement(type, props) {
      let element = new DocElement(type);
      // The only place initial props arrive: the renderer never replays
      // patchProp for a prop that was already there on mount. `children`
      // belongs to the reconciler, and `props` is only safe to read here.
      for (let name in props) {
        if (name === "children") continue;
        if (props[name] !== undefined) element.props[name] = props[name];
      }
      ops.push(`createElement <${type}>`);
      return element;
    },

    createText(text) {
      ops.push(`createText ${show(text)}`);
      return { kind: "text", text, parent: null };
    },

    createComment(label) {
      ops.push(`createComment ${show(label)}`);
      return { kind: "anchor", label, parent: null };
    },

    setText(node, text) {
      if (node.kind !== "text") throw new Error(`setText on a ${node.kind} node`);
      ops.push(`setText ${show(node.text)} -> ${show(text)}`);
      node.text = text;
    },

    patchProp(element, name, previous, next) {
      ops.push(`patchProp <${element.type}>.${name} ${show(previous)} -> ${show(next)}`);
      if (next === undefined) delete element.props[name];
      else element.props[name] = next;
    },

    insert(node, parent, before) {
      // Detach before locating the anchor: when the node is already a child of
      // this parent, removing it shifts every index after it by one.
      detach(node);
      let index = parent.children.length;
      if (before !== null) {
        index = parent.children.indexOf(before);
        if (index === -1) {
          throw new Error(`anchor ${describe(before)} is not a child of <${parent.type}>`);
        }
      }
      parent.children.splice(index, 0, node);
      node.parent = parent;
      ops.push(
        `insert ${describe(node)} into <${parent.type}> before ` +
          (before === null ? "end" : describe(before)),
      );
    },

    remove(node) {
      // One call per removed subtree: descendants come with it, and a node
      // whose parent is already gone is not an error.
      ops.push(`remove ${describe(node)}`);
      detach(node);
    },

    parentNode(node) {
      return node.parent;
    },

    nextSibling(node) {
      let parent = node.parent;
      if (parent === null) return null;
      let index = parent.children.indexOf(node);
      if (index === -1) return null;
      return parent.children[index + 1] ?? null;
    },

    commit(target) {
      ops.push(`commit <${target.type}>`);
    },

    getEventTarget(element) {
      // Elements are their own event target and keep that identity for their
      // whole lifetime, which is what mixins bind to.
      return element;
    },
  };

  return {
    container,
    host,
    takeOps() {
      return ops.splice(0, ops.length);
    },
    format() {
      return formatTree(container.children);
    },
    toJSON() {
      return toJson(container.children);
    },
  };
}
```

Four of those operations have contracts that are easy to get wrong on the first try.

**`createElement` is the only place initial props arrive.** The renderer does not replay `patchProp` for props that were present at mount, so an element that ignores `props` here mounts blank and never recovers. Skip `children`, because the reconciler mounts children itself, and do not retain or mutate the props object: it is the live props object of the element being rendered.

**`insert` is also `move`.** The renderer calls it with nodes that already have a parent, and `before` is always a node currently in `parent` or `null` to append. When the node being moved is a sibling of the anchor, its own removal shifts the anchor's index, which is why this host detaches first and looks the anchor up afterwards. Getting that order backwards puts moved nodes one slot off, and only in the reorder case.

**`remove` receives the top of a removed subtree.** Descendants are gone with it and never arrive as separate calls, so a backend that releases resources per node should walk the subtree itself. It also has to tolerate a node whose parent is already gone, because the renderer removes its replacement anchors unconditionally.

**`patchProp` runs for updates only.** A removed prop arrives with `next` as `undefined`, `children` and `key` never arrive at all, and the comparison behind it is `!==`. A prop rebuilt every render, such as the `style` object below, is patched on every update even when its fields are unchanged, so keep this operation cheap and safe to repeat.

The two reads, `parentNode` and `nextSibling`, are how the renderer walks a range when a fragment or component covering several sibling nodes moves. `commit` is optional and runs once per batch, after every mutation and before component tasks. Here it appends a line to the log. A backend that paints from a scene graph redraws here instead of redrawing per mutation. `getEventTarget` is optional too, and a host without it rejects every `mix` prop with `Mixins are not supported by this renderer host` rather than dropping mixins silently.

## Give the elements a typed surface

`<album title="Thriller" />` does not typecheck. `JSX.IntrinsicElements` declares the HTML, SVG, and MathML names, and `album` is not one of them. Wrap each host tag in a component that calls `createElement` instead, which is how `remix/tui` ships `Box` and `Text`. The props of your elements are then types you control.

```ts filename=demos/doc-renderer/elements.ts
import { createElement, createMixin } from "remix/ui";
import type { ElementProps, Handle, MixInput, RemixNode } from "remix/ui";

import type { DocElement } from "./doc-tree.ts";

export type DocStyle = {
  color?: string;
  weight?: "bold" | "normal";
};

/**
 * Composes a `style` prop for a document element. Styles merge shallowly in
 * the order the mixins are listed, so a later `style()` overrides the fields
 * it names and leaves the rest alone.
 */
export const style = createMixin<
  DocElement,
  [styles: DocStyle],
  ElementProps & { style?: DocStyle }
>((handle) => (styles, props) => {
  let inherited = props.style;
  return createElement(handle.element, {
    ...props,
    style: inherited === undefined ? styles : { ...inherited, ...styles },
  });
});

export interface LibraryProps {
  title: string;
  mix?: MixInput<DocElement>;
  children?: RemixNode;
}

export interface AlbumProps {
  title: string;
  year: number;
  selected?: boolean;
  mix?: MixInput<DocElement>;
  children?: RemixNode;
}

export interface LineProps {
  mix?: MixInput<DocElement>;
  children?: RemixNode;
}

export function Library(handle: Handle<LibraryProps>): () => RemixNode {
  // A fresh props object every render: the handle's props keep their identity
  // across updates, the renderer diffs host props by value, and mixins
  // recompose from what the caller passed instead of from the last render.
  return () =>
    createElement(
      "library",
      { title: handle.props.title, mix: handle.props.mix },
      handle.props.children,
    );
}

export function Album(handle: Handle<AlbumProps>): () => RemixNode {
  return () =>
    createElement(
      "album",
      {
        title: handle.props.title,
        year: handle.props.year,
        selected: handle.props.selected,
        mix: handle.props.mix,
      },
      handle.props.children,
    );
}

export function Line(handle: Handle<LineProps>): () => RemixNode {
  return () => createElement("line", { mix: handle.props.mix }, handle.props.children);
}
```

Each wrapper names the props its tag accepts and passes children as the third argument to `createElement`. Building that object fresh on every render is deliberate: `handle.props` keeps one identity for the life of the component, and the renderer diffs the object it was handed prop by prop against the previous one, so reusing one object would hide every change.

`style` is a real mixin and never touches a node. It reads the `style` prop the mixins ahead of it composed, merges its own fields over it, and re-renders the element with the result, so `mix={[style({ weight: "normal" }), style({ weight: "bold" })]}` arrives at the host as one `style` prop with `weight: "bold"`. Nothing is retained between renders, which is what makes dropping a conditional `style()` clear exactly the fields it contributed. The `mix` prop itself is resolved before `createElement` runs and never reaches the host.

`MixInput<DocElement>` is the type that ties the two halves together. It types the `mix` prop, and it tells `on()` which event map to use, so `on("doc:press", ...)` resolves against `DocElementEventMap` the way `on("click", ...)` resolves against `HTMLElementEventMap`.

## Render the albums

The components are ordinary Remix components. Each row keeps its play count in setup scope and asks for its own update when the element is pressed, and the list is keyed by album id.

```tsx filename=demos/doc-renderer/app.tsx
import { on } from "remix/ui";
import type { Handle, RemixNode } from "remix/ui";

import { Album, Library, Line, style } from "./elements.ts";

export type AlbumRecord = {
  artist: string;
  id: string;
  title: string;
  year: number;
};

export const albums: AlbumRecord[] = [
  { artist: "Michael Jackson", id: "thriller", title: "Thriller", year: 1983 },
  { artist: "Fleetwood Mac", id: "rumours", title: "Rumours", year: 1977 },
  { artist: "Miles Davis", id: "kind-of-blue", title: "Kind of Blue", year: 1959 },
];

function AlbumRow(handle: Handle<{ album: AlbumRecord }>): () => RemixNode {
  // Setup runs once per mounted row, so `plays` is this row's own state.
  let plays = 0;

  return () => (
    <Album
      title={handle.props.album.title}
      year={handle.props.album.year}
      selected={plays > 0}
      mix={[
        style({ color: "default", weight: plays > 0 ? "bold" : "normal" }),
        on("doc:press", () => {
          plays++;
          void handle.update();
        }),
      ]}
    >
      <Line mix={style({ color: "dim" })}>
        {handle.props.album.artist}
        {` · ${plays} plays`}
      </Line>
    </Album>
  );
}

export function App(handle: Handle<{ albums: AlbumRecord[] }>): () => RemixNode {
  return () => (
    <Library title={`Albums (${handle.props.albums.length})`}>
      {handle.props.albums.map((album) => (
        <AlbumRow key={album.id} album={album} />
      ))}
    </Library>
  );
}
```

`main.tsx` drives the walkthrough. It creates the document and renderer, then prints the tree and host calls for eight steps. Each error scenario uses a separate root so a failed render does not affect the album list.

```tsx filename=demos/doc-renderer/main.tsx
import { createRenderer } from "remix/ui/renderer";
import type { Handle, RemixNode } from "remix/ui";

import { App, albums } from "./app.tsx";
import { createDocument } from "./doc-host.ts";
import { queryAll } from "./doc-tree.ts";
import { Library, Line } from "./elements.ts";

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

let doc = createDocument();
let root = createRenderer(doc.host).createRoot(doc.container);

section("1. mount");
root.render(<App albums={albums} />);
console.log(doc.format());
console.log("--- host operations ---");
console.log(doc.takeOps().join("\n"));

section("2. press Thriller");
let thriller = queryAll(doc.container, "album")[0];
thriller.dispatchEvent(new Event("doc:press"));
root.flush();
console.log(doc.format());
console.log("--- host operations ---");
console.log(doc.takeOps().join("\n"));

section("3. reverse the list");
let reversed = [...albums].reverse();
root.render(<App albums={reversed} />);
console.log(doc.format());
console.log("--- host operations ---");
console.log(doc.takeOps().join("\n"));
console.log("same <album> object for Thriller:", queryAll(doc.container, "album")[2] === thriller);

section("4. remove Rumours");
let rumours = queryAll(doc.container, "album")[1];
root.render(<App albums={reversed.filter((album) => album.id !== "rumours")} />);
console.log(doc.format());
console.log("--- host operations ---");
console.log(doc.takeOps().join("\n"));

rumours.dispatchEvent(new Event("doc:press"));
root.flush();
console.log("detached from the tree:", rumours.parent === null);
console.log("host operations from that dispatch:", doc.takeOps().length);

section("5. snapshot as JSON");
console.log(JSON.stringify(doc.toJSON()[0], null, 2).split("\n").slice(0, 12).join("\n"));

section("6. a task queued in setup");
let tasks = createDocument();
let taskRoot = createRenderer(tasks.host).createRoot(tasks.container);
let claimed: string[] = [];
taskRoot.addEventListener("error", (event) => {
  event.preventDefault();
  claimed.push(String(event.error));
});

let seenByTask = "";

function Artwork(handle: Handle): () => RemixNode {
  handle.queueTask(() => {
    seenByTask = tasks.format();
    throw new Error("artwork fetch failed after commit");
  });
  return () => <Line>artwork</Line>;
}

taskRoot.render(<Artwork />);
await Promise.resolve();
console.log("host operations:", tasks.takeOps().join(", "));
console.log("the task saw:", JSON.stringify(seenByTask));
console.log("claimed by the root listener:", claimed);
taskRoot.unmount();

section("7. a render that throws");
let shelf = createDocument();
let shelfRoot = createRenderer(shelf.host).createRoot(shelf.container);

function Missing(): never {
  throw new Error("album artwork is missing");
}

function Shelf(handle: Handle<{ broken: boolean; title: string }>): () => RemixNode {
  return () => (
    <Library title={handle.props.title}>
      {handle.props.broken ? <Missing /> : <Line>artwork</Line>}
    </Library>
  );
}

shelfRoot.render(<Shelf broken={false} title="Albums (1)" />);
shelf.takeOps();

try {
  shelfRoot.render(<Shelf broken={true} title="Albums (retry)" />);
} catch (error) {
  console.log("render() threw:", String(error));
}

console.log("tree after the failed render:", JSON.stringify(shelf.format()));
console.log("--- host operations ---");
console.log(shelf.takeOps().join("\n"));
shelfRoot.unmount();

section("8. unmount");
doc.container.children.push({ kind: "text", text: "-- host owned --", parent: doc.container });
root.unmount();
console.log(doc.format());
console.log("--- host operations ---");
console.log(doc.takeOps().join("\n"));
console.log("render after unmount:", tryRender());

function tryRender(): string {
  try {
    root.render(<App albums={albums} />);
    return "no error";
  } catch (error) {
    return String(error);
  }
}
```

Run it:

```sh
pnpm -C demos/doc-renderer start
```

The first step prints the mounted tree:

```txt
=== 1. mount ===
<library title="Albums (3)">
  <album selected=false style={"color":"default","weight":"normal"} title="Thriller" year=1983>
    <line style={"color":"dim"}>
      Michael Jackson
       · 0 plays
  <album selected=false style={"color":"default","weight":"normal"} title="Rumours" year=1977>
    <line style={"color":"dim"}>
      Fleetwood Mac
       · 0 plays
  <album selected=false style={"color":"default","weight":"normal"} title="Kind of Blue" year=1959>
    <line style={"color":"dim"}>
      Miles Davis
       · 0 plays
```

And the calls that built it, trimmed to the first album:

```txt
createElement <library>
createElement <album>
createElement <line>
createText "Michael Jackson"
insert "Michael Jackson" into <line> before end
createText " · 0 plays"
insert " · 0 plays" into <line> before end
insert <line> into <album> before end
insert <album Thriller> into <library> before end
... the same eight calls for Rumours and Kind of Blue ...
insert <library Albums (3)> into <library-root> before end
commit <library-root>
```

A mount fills a subtree bottom up. Each element is created with its props already applied, its children are inserted into it, and only then is it inserted into its own parent, so a node is never visible in an incomplete state. The `<library>` element reaches the container last, and `commit` runs once for the whole batch rather than once per mutation. The `style` prop is on the elements even though no `patchProp` call appears, because the mixins composed it before `createElement` ran.

## Update one album

Step 2 dispatches a real `Event` on the first `<album>` element. The `on("doc:press", ...)` handler bumps `plays` and calls `handle.update()`, which schedules that one component. `root.flush()` drains the pending work immediately instead of waiting for the microtask, which is what makes this script readable. Awaiting the promise from `handle.update()` works the same way and resolves after the commit.

```txt
=== 2. press Thriller ===
<library title="Albums (3)">
  <album selected=true style={"color":"default","weight":"bold"} title="Thriller" year=1983>
    <line style={"color":"dim"}>
      Michael Jackson
       · 1 plays
  ...
--- host operations ---
setText " · 0 plays" -> " · 1 plays"
patchProp <line>.style {"color":"dim"} -> {"color":"dim"}
patchProp <album>.selected false -> true
patchProp <album>.style {"color":"default","weight":"normal"} -> {"color":"default","weight":"bold"}
commit <library-root>
```

Only the pressed row re-rendered, and inside it only the text node whose value changed was touched. The artist text node, the `<line>` and `<album>` elements, and the whole rest of the list are the same objects they were after the mount.

That `<line>.style` patch with identical values is the `!==` comparison showing through: `style()` builds a new object every render, so the prop is always a new reference. This is why `patchProp` should be cheap and idempotent, and why a backend that has to diff deeply should do it there.

## Reverse the list

Step 3 renders the same three rows in the opposite order.

```txt
=== 3. reverse the list ===
<library title="Albums (3)">
  <album selected=false style={"color":"default","weight":"normal"} title="Kind of Blue" year=1959>
    ...
  <album selected=true style={"color":"default","weight":"bold"} title="Thriller" year=1983>
    <line style={"color":"dim"}>
      Michael Jackson
       · 1 plays
--- host operations ---
... six style patches, one pair per row ...
insert <album Rumours> into <library> before <album Thriller>
insert <album Kind of Blue> into <library> before <album Rumours>
commit <library-root>
same <album> object for Thriller: true
```

Nothing was created and nothing was removed. Thriller still holds the play count from step 2 and is still the same host element, because `key={album.id}` matched the previous row to the new position. State living in setup scope travels with the key rather than with the index.

Two `insert` calls reordered three rows. The renderer keeps the longest increasing run of matched children in place and moves only the rest, walking backwards so the anchor is always a node whose final position is already settled. Thriller is on that stable run, so it never moved at all. When the moved child is a fragment or a component covering several sibling nodes, the whole contiguous range moves, which is what `nextSibling` is for.

## Remove a row

Step 4 renders the list without Rumours.

```txt
=== 4. remove Rumours ===
--- host operations ---
remove <album Rumours>
... four style patches for the surviving rows ...
patchProp <library>.title "Albums (3)" -> "Albums (2)"
commit <library-root>
detached from the tree: true
host operations from that dispatch: 0
```

One `remove` call took out the row, its `<line>`, and both text nodes. The renderer tore the subtree down internally and left the host a single call, which is why a real backend should free its own per-node resources when it sees that node go.

The last two lines are the lifetime half of the same removal. The script kept a reference to the detached `<album>` element and dispatched `doc:press` on it after the render, and nothing happened. Unmounting the row aborted the component's `handle.signal`, ran the mixin `remove` lifecycle, and unbound the `on()` listener, so there was no handler left to bump the counter and no host call to record. A `handle.update()` that was already pending resolves with an aborted signal instead of rendering, so a component that checks `signal.aborted` after an await stops on its own.

Step 5 prints the same tree through `toJSON()`, which is worth having for a moment like this: props are plain data on plain objects, so a snapshot is a `JSON.stringify` away and a test can assert on it directly.

## Commit, tasks, and errors

Step 6 mounts a component that queues a task in setup, reads the document from inside the task, and then throws.

```txt
=== 6. a task queued in setup ===
host operations: createElement <line>, createText "artwork", insert "artwork" into <line> before end, insert <line> into <library-root> before end, commit <library-root>
the task saw: "<line>\n  artwork"
claimed by the root listener: [ 'Error: artwork fetch failed after commit' ]
```

The task ran after `commit`, so it observed the finished tree. That is the ordering guarantee for a batch: every mutation, then the host commit, then component tasks and the promises returned by `handle.update()`. A backend that measures or paints in `commit` can rely on tasks seeing the painted result.

Nobody was standing there to catch the task's error, so the root dispatched a cancelable `error` event carrying it. Calling `preventDefault()` is the handshake that claims it. An error no listener claims is rethrown from a macrotask so the platform reports it instead of it disappearing. The same event covers failures from scheduled updates, from your `commit`, and from an update loop that will not settle, which the scheduler stops after 50 cascading updates with `handle.update() infinite loop detected in ...`.

Step 7 is the other error path. A reconciliation failure has a caller, so it is thrown from `render()`.

```txt
=== 7. a render that throws ===
render() threw: Error: album artwork is missing
tree after the failed render: "<library title=\"Albums (1)\">"
--- host operations ---
createComment "rmx:replace"
insert [rmx:replace] into <library> before <line>
remove <line>
remove [rmx:replace]
commit <library-root>
```

The anchor from earlier shows up here. Replacing the `<line>` with a component of a different type meant holding its position with a `createComment` node, removing the old node, and mounting the replacement in its place. The replacement threw, so the anchor was cleaned up on the way out and the tree kept the empty `<library>`.

Reconciliation is not transactional. Mutations that already happened are not rolled back, and the title patch that would have followed the children never ran. The renderer does release what it created in the failed pass, so components that mounted during it are aborted rather than left live, but the host tree is in an intermediate state. When you need a clean recovery, unmount the root and create a new one.

## Unmount

Step 8 pushes a node the renderer knows nothing about into the container, then unmounts.

```txt
=== 8. unmount ===
-- host owned --
--- host operations ---
remove <library Albums (2)>
commit <library-root>
render after unmount: Error: Cannot render into an unmounted renderer root
```

The host-owned text survived. A root appends to its container and manages only the nodes it created, so a container can hold chrome the embedder owns, and the renderer keeps its own range in front of trailing nodes it did not create.

Unmounting removes the tree, aborts every component signal, and settles pending updates. It is idempotent, and rendering into a root afterwards throws instead of quietly recreating the tree.

## Where to go next

`remix/tui` is this same interface with a real backend behind it. [Terminal Applications](/terminal-applications/) builds an interactive album list with `Box`, `Text`, `style()`, and `on()`, and [Embedding Terminal Renderers](/embedding-terminal-renderers/) covers owning the bytes, resizing, and shutdown yourself.

When you are ready to write a backend that paints, read its host next to yours: [`packages/tui/src/lib/host.ts`](https://github.com/remix-run/remix/blob/main/packages/tui/src/lib/host.ts) is a full implementation with real style validation and event dispatch, and [`packages/ui/src/runtime/universal/host.ts`](https://github.com/remix-run/remix/blob/main/packages/ui/src/runtime/universal/host.ts) carries the per-operation contract in its doc comments. The component model those operations serve is the subject of [Rendering UI](/rendering-ui/), and the mixin system behind `mix` is in [Interactivity](/interactivity/).
