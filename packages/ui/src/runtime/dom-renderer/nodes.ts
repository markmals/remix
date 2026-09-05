const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Prop bag used as the "previous" props of a node that was just created or
 * adopted, so initial props go through the same patch path as updates.
 */
export const NO_PROPS: Readonly<Record<string, unknown>> = {}

/**
 * Reads the document that owns a parent node, so nodes are created in the same
 * document they are mounted into.
 *
 * @param parent Parent the new node is created for.
 * @returns The owner document of `parent`.
 */
export function getOwnerDocument(parent: ParentNode): Document {
  if (parent instanceof Document) return parent
  return parent.ownerDocument ?? document
}

/**
 * Reports whether children of a parent belong to the SVG namespace.
 *
 * `foreignObject` is an SVG element whose subtree returns to HTML, which is
 * what makes it usable for embedding HTML inside a drawing.
 *
 * @param parent Parent the child is created under.
 * @returns True when children of `parent` are SVG elements.
 */
export function isSvgParent(parent: ParentNode): boolean {
  return (
    parent instanceof Element &&
    parent.namespaceURI === SVG_NS &&
    parent.localName !== 'foreignObject'
  )
}

/**
 * Creates an element in the namespace its parent implies. `<svg>` opens an SVG
 * subtree from anywhere, everything else inherits from the parent.
 *
 * @param type Host tag name.
 * @param parent Parent the element is created for.
 * @returns The new element.
 */
export function createHostElement(type: string, parent: ParentNode): Element {
  let doc = getOwnerDocument(parent)
  if (type === 'svg' || isSvgParent(parent)) return doc.createElementNS(SVG_NS, type)
  return doc.createElement(type)
}

/**
 * Reports whether a host tag names the document head. JSX allows `<head>` in
 * any casing an HTML author would write.
 *
 * @param type Host tag name.
 * @returns True when the tag is a head element.
 */
export function isHeadType(type: string): boolean {
  if (type === 'head') return true
  if (type.length !== 4) return false
  return type.toLowerCase() === 'head'
}

/**
 * Reads the real head a `<head>` element mounts into.
 *
 * @param parent Parent the head element is mounted under.
 * @returns The head of the owning document, or null when there is none.
 */
export function getDocumentHead(parent: ParentNode): HTMLHeadElement | null {
  if (parent instanceof Document) return parent.head
  if (parent instanceof Node) return parent.ownerDocument?.head ?? null
  return null
}
