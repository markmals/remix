import type { Key } from '../key.ts';
/**
 * Minimal sibling shape the keyed matcher needs from a child node.
 *
 * Both input nodes and committed nodes satisfy this shape, so the matching
 * pass is shared by every renderer host instead of being reimplemented per
 * backend.
 */
export type KeyedChild = {
    readonly key?: Key;
    readonly type: unknown;
};
/**
 * Reports whether any sibling carries an explicit key.
 *
 * @param children Sibling list to inspect.
 * @returns `true` when at least one sibling has a non-nullish key.
 */
export declare function hasKeyedChildren(children: readonly KeyedChild[]): boolean;
/**
 * Warns once per render about duplicate sibling keys.
 *
 * Duplicate keys make identity ambiguous, so the matcher falls back to
 * first-match-wins and the extra nodes are treated as new.
 *
 * @param children Sibling list to inspect.
 */
export declare function warnDuplicateKeys(children: readonly KeyedChild[]): void;
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
export declare function matchKeyedChildren(curr: readonly KeyedChild[], next: readonly KeyedChild[]): number[];
/**
 * Summarizes a match array so the caller can skip work it does not need.
 *
 * @param currentLength Number of currently mounted siblings.
 * @param matches Current-index matches parallel to the incoming siblings.
 * @returns Whether any current sibling is unmatched, and whether the matched
 * order is already correct so no node needs to move.
 */
export declare function analyzeKeyedChildMatches(currentLength: number, matches: readonly number[]): {
    hasRemovals: boolean;
    canSkipPlacement: boolean;
};
/**
 * Computes the longest increasing subsequence of matched indexes.
 *
 * Nodes on that subsequence are already in relative order and must not move,
 * which keeps the number of host moves minimal.
 *
 * @param matches Current-index matches parallel to the incoming siblings.
 * @returns Indexes into `matches` that can stay in place.
 */
export declare function lisMatches(matches: readonly number[]): number[];
