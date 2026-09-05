import { logHydrationMismatch } from '../client-entries.ts'
import { patchHostProps } from '../core/props.ts'
import type {
  RendererHydratedElement,
  RendererHydration,
  RendererHydrationCursor,
} from '../../renderer.ts'
import { isFrameStartComment } from './frames.ts'
import { getDocumentHead, isHeadType, isSvgParent, NO_PROPS } from './nodes.ts'

/**
 * Hydration operations for server-rendered DOM: the renderer adopts the nodes
 * the server already produced instead of creating and inserting new ones.
 */
export const domHydration: RendererHydration<Node, Element, ParentNode> = {
  normalize(cursor) {
    let current = cursor.current
    // `null` means nothing is left to adopt, `undefined` means hydration
    // stopped; neither is a node to normalize.
    if (current == null) return
    cursor.current = skipAdoptableComments(current, cursor.end)
  },

  adoptText(text, _parent, cursor) {
    let current = cursor.current === cursor.end ? null : cursor.current
    if (!(current instanceof Text)) return null

    if (current.data !== text) {
      if (current.data.startsWith(text) && text.length < current.data.length) {
        // The server renders adjacent text as one node: `<span>Hello {name}</span>`
        // arrives as "Hello world" for the vnodes ["Hello ", "world"]. Split at
        // the boundary and leave the remainder for the next vnode.
        let remainder = current.splitText(text.length)
        cursor.current = remainder
        return current
      }
      logHydrationMismatch('text mismatch', current.data, text)
      current.data = text
    }

    cursor.current = current.nextSibling
    return current
  },

  adoptElement(type, props, parent, cursor) {
    // The end of a bounded sequence belongs to whoever owns the boundary, so it
    // is never a candidate even if a caller skipped `normalize`.
    let current = cursor.current === cursor.end ? null : cursor.current

    if (isHeadType(type)) {
      let head = getDocumentHead(parent)
      if (head !== null) return adoptHead(head, props, current, cursor)
    }

    if (!(current instanceof Element)) return null

    // SVG tag names are case sensitive (`linearGradient`, `clipPath`); HTML tag
    // names are not, and the parser reports them uppercased.
    let svg = type === 'svg' || isSvgParent(parent)
    let currentTag = svg ? current.tagName : current.tagName.toLowerCase()
    if (currentTag === type) return adopt(current, props, cursor)

    // Browser extensions inject nodes at the start of containers. Skip one node
    // and retry once, leaving the skipped node in place, so a single stray
    // element does not abandon hydration for the whole subtree.
    let candidate = skipAdoptableComments(current.nextSibling, cursor.end)
    if (candidate instanceof Element) {
      let candidateTag = svg ? candidate.tagName : candidate.tagName.toLowerCase()
      if (candidateTag === type) return adopt(candidate, props, cursor)
    }

    logHydrationMismatch('tag', currentTag, type)
    // Mismatched markup is left alone; stop adopting in this tree and let the
    // renderer create the rest.
    cursor.current = undefined
    return null
  },
}

function adopt(
  element: Element,
  props: Readonly<Record<string, unknown>>,
  cursor: RendererHydrationCursor<Node>,
): RendererHydratedElement<Node, Element> {
  cursor.current = element.nextSibling
  patchHostProps(NO_PROPS, props, element)
  return { element, children: { current: element.firstChild } }
}

function adoptHead(
  head: HTMLHeadElement,
  props: Readonly<Record<string, unknown>>,
  current: Node | null | undefined,
  cursor: RendererHydrationCursor<Node>,
): RendererHydratedElement<Node, Element> {
  // A `<head>` element in the markup is the head this vnode owns, wherever the
  // server put it. Anything else means the head content was streamed inline, so
  // the head children keep adopting from the position the vnode appears at.
  let children: RendererHydrationCursor<Node> = cursor

  if (current instanceof Element && current.tagName.toLowerCase() === 'head') {
    // Read the first child before hoisting: the node moves into the real head
    // with its siblings in order, so the cursor stays valid.
    children = { current: current.firstChild }
    cursor.current = current.nextSibling
    if (current !== head) {
      while (current.firstChild !== null) {
        head.appendChild(current.firstChild)
      }
      current.remove()
    }
  }

  patchHostProps(NO_PROPS, props, head)
  return { element: head, children }
}

function skipAdoptableComments(current: Node | null, end: Node | null | undefined): Node | null {
  let node = current
  while (node !== null && node !== end) {
    // Comments carry no vnode of their own, except frame markers: a `<Frame>`
    // claims its own `rmx:f` comment, and no other vnode may consume one.
    if (node.nodeType !== Node.COMMENT_NODE || isFrameStartComment(node)) return node
    node = node.nextSibling
  }
  return null
}
