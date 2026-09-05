import type { Key } from '../key.ts'

/**
 * Minimal sibling shape the keyed matcher needs from a child node.
 *
 * Both input nodes and committed nodes satisfy this shape, so the matching
 * pass is shared by every renderer host instead of being reimplemented per
 * backend.
 */
export type KeyedChild = {
  readonly key?: Key
  readonly type: unknown
}

/**
 * Reports whether any sibling carries an explicit key.
 *
 * @param children Sibling list to inspect.
 * @returns `true` when at least one sibling has a non-nullish key.
 */
export function hasKeyedChildren(children: readonly KeyedChild[]): boolean {
  for (let i = 0; i < children.length; i++) {
    if (children[i].key != null) return true
  }
  return false
}

/**
 * Warns once per render about duplicate sibling keys.
 *
 * Duplicate keys make identity ambiguous, so the matcher falls back to
 * first-match-wins and the extra nodes are treated as new.
 *
 * @param children Sibling list to inspect.
 */
export function warnDuplicateKeys(children: readonly KeyedChild[]): void {
  let seenKeys: Set<Key> | undefined
  let duplicateKeys: Set<Key> | undefined

  for (let node of children) {
    if (node.key == null) continue

    if (!seenKeys) {
      seenKeys = new Set([node.key])
      continue
    }

    if (seenKeys.has(node.key)) {
      duplicateKeys ??= new Set()
      duplicateKeys.add(node.key)
    } else {
      seenKeys.add(node.key)
    }
  }

  if (duplicateKeys?.size) {
    let quotedKeys = Array.from(duplicateKeys, (key) => `"${String(key)}"`)
    console.warn(
      `Duplicate keys detected in siblings: ${quotedKeys.join(', ')}. Keys should be unique.`,
    )
  }
}

/**
 * Matches next siblings against current siblings by key and type.
 *
 * Results are arrays of current indexes parallel to `next`, where `-1` means
 * "no match, mount a new node". Plain numbers instead of wrapper objects keep
 * large keyed diffs (1000-row tables) allocation-free. Cheap shape-specific
 * passes run first (unchanged prefix, single removal, pair swap) before the
 * general key-map pass, which is the only one that can report duplicate keys.
 *
 * @param curr Currently mounted siblings.
 * @param next Incoming siblings.
 * @returns Current-index matches parallel to `next`.
 */
export function matchKeyedChildren(
  curr: readonly KeyedChild[],
  next: readonly KeyedChild[],
): number[] {
  let matches =
    matchKeyedChildrenInOrder(curr, next) ??
    matchKeyedChildrenAfterSingleRemoval(curr, next) ??
    matchKeyedChildrenAfterPairSwap(curr, next)
  if (matches) return matches

  warnDuplicateKeys(next)
  return matchKeyedChildrenByKeyMap(curr, next)
}

function matchKeyedChildrenByKeyMap(
  curr: readonly KeyedChild[],
  next: readonly KeyedChild[],
): number[] {
  let oldKeyMap = new Map<Key, number>()
  let usedOldIndexes = new Set<number>()
  let unkeyedSearchStart = 0

  for (let index = 0; index < curr.length; index++) {
    let key = curr[index].key
    if (key != null) oldKeyMap.set(key, index)
  }

  let matches: number[] = []
  for (let nextIndex = 0; nextIndex < next.length; nextIndex++) {
    let nextNode = next[nextIndex]
    let oldIndex = -1

    if (nextNode.key != null) {
      let keyedOldIndex = oldKeyMap.get(nextNode.key)
      if (keyedOldIndex !== undefined) {
        let oldNode = curr[keyedOldIndex]
        if (!usedOldIndexes.has(keyedOldIndex) && oldNode.type === nextNode.type) {
          oldIndex = keyedOldIndex
        }
      }
    } else {
      for (let index = unkeyedSearchStart; index < curr.length; index++) {
        let oldNode = curr[index]
        if (usedOldIndexes.has(index) || oldNode.key != null || oldNode.type !== nextNode.type) {
          continue
        }

        oldIndex = index
        unkeyedSearchStart = index + 1
        break
      }
    }

    if (oldIndex >= 0) usedOldIndexes.add(oldIndex)
    matches.push(oldIndex)
  }

  return matches
}

function matchKeyedChildrenInOrder(
  curr: readonly KeyedChild[],
  next: readonly KeyedChild[],
): number[] | null {
  let length = Math.min(curr.length, next.length)
  let matches: number[] = []

  for (let index = 0; index < length; index++) {
    let nextNode = next[index]
    if (nextNode.key == null) return null

    let oldNode = curr[index]
    if (oldNode.key !== nextNode.key || oldNode.type !== nextNode.type) {
      return null
    }

    matches.push(index)
  }

  for (let index = length; index < next.length; index++) {
    if (next[index].key == null) return null
    matches.push(-1)
  }

  return matches
}

function matchKeyedChildrenAfterSingleRemoval(
  curr: readonly KeyedChild[],
  next: readonly KeyedChild[],
): number[] | null {
  if (curr.length !== next.length + 1) return null

  let matches: number[] = []
  let oldIndex = 0
  let skippedOldNode = false

  for (let nextIndex = 0; nextIndex < next.length; nextIndex++) {
    let nextNode = next[nextIndex]
    if (nextNode.key == null) return null

    let oldNode = curr[oldIndex]
    if (oldNode.key === nextNode.key && oldNode.type === nextNode.type) {
      matches.push(oldIndex)
      oldIndex++
      continue
    }

    if (skippedOldNode) return null
    skippedOldNode = true
    oldIndex++

    oldNode = curr[oldIndex]
    if (oldNode.key !== nextNode.key || oldNode.type !== nextNode.type) {
      return null
    }

    matches.push(oldIndex)
    oldIndex++
  }

  return matches
}

function matchKeyedChildrenAfterPairSwap(
  curr: readonly KeyedChild[],
  next: readonly KeyedChild[],
): number[] | null {
  if (curr.length !== next.length) return null

  let matches: number[] = []
  let firstMismatch = -1
  let secondMismatch = -1

  for (let index = 0; index < next.length; index++) {
    let nextNode = next[index]
    if (nextNode.key == null) return null

    let oldNode = curr[index]
    if (oldNode.key === nextNode.key && oldNode.type === nextNode.type) {
      matches.push(index)
      continue
    }

    if (firstMismatch === -1) {
      firstMismatch = index
    } else if (secondMismatch === -1) {
      secondMismatch = index
    } else {
      return null
    }
    matches.push(-1)
  }

  if (firstMismatch === -1) return matches
  if (secondMismatch === -1) return null

  let firstOldNode = curr[firstMismatch]
  let secondOldNode = curr[secondMismatch]
  let firstNextNode = next[firstMismatch]
  let secondNextNode = next[secondMismatch]

  if (
    firstOldNode.key !== secondNextNode.key ||
    firstOldNode.type !== secondNextNode.type ||
    secondOldNode.key !== firstNextNode.key ||
    secondOldNode.type !== firstNextNode.type
  ) {
    return null
  }

  matches[firstMismatch] = secondMismatch
  matches[secondMismatch] = firstMismatch
  return matches
}

/**
 * Summarizes a match array so the caller can skip work it does not need.
 *
 * @param currentLength Number of currently mounted siblings.
 * @param matches Current-index matches parallel to the incoming siblings.
 * @returns Whether any current sibling is unmatched, and whether the matched
 * order is already correct so no node needs to move.
 */
export function analyzeKeyedChildMatches(
  currentLength: number,
  matches: readonly number[],
): { hasRemovals: boolean; canSkipPlacement: boolean } {
  let hasRemovals = matches.length !== currentLength
  let canSkipPlacement = true
  let lastOldIndex = -1
  let sawNewNode = false

  for (let index = 0; index < matches.length; index++) {
    let oldIndex = matches[index]
    if (oldIndex < 0) {
      hasRemovals = true
      sawNewNode = true
      continue
    }

    if (sawNewNode || oldIndex < lastOldIndex) {
      canSkipPlacement = false
    }
    lastOldIndex = oldIndex
  }

  return { hasRemovals, canSkipPlacement }
}

/**
 * Computes the longest increasing subsequence of matched indexes.
 *
 * Nodes on that subsequence are already in relative order and must not move,
 * which keeps the number of host moves minimal.
 *
 * @param matches Current-index matches parallel to the incoming siblings.
 * @returns Indexes into `matches` that can stay in place.
 */
export function lisMatches(matches: readonly number[]): number[] {
  let predecessors = Array.from<number>({ length: matches.length })
  let tails: number[] = []

  for (let index = 0; index < matches.length; index++) {
    let value = matches[index] + 1
    if (value === 0) continue

    let low = 0
    let high = tails.length

    while (low < high) {
      let middle = (low + high) >> 1

      if (matches[tails[middle]] + 1 < value) {
        low = middle + 1
      } else {
        high = middle
      }
    }

    predecessors[index] = low > 0 ? tails[low - 1] : -1
    tails[low] = index
  }

  let cursor = tails.at(-1) ?? -1

  for (let index = tails.length - 1; index >= 0; index--) {
    tails[index] = cursor
    cursor = predecessors[cursor] ?? -1
  }

  return tails
}
