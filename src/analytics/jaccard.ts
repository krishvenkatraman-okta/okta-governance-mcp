/**
 * Jaccard similarity utilities
 *
 * Pure set-based similarity functions used by role mining (clustering)
 * and outlier detection (peer comparison). No Okta dependencies.
 */

/**
 * Jaccard similarity coefficient between two sets.
 *
 * Defined as the size of the intersection divided by the size of the
 * union. Returns 0 when both inputs are empty (the conventional choice
 * to avoid 0/0 — undefined similarity is treated as "no shared access").
 *
 * @param a - First set
 * @param b - Second set
 * @returns Similarity in [0, 1]
 *
 * @example
 * ```typescript
 * jaccardSimilarity(new Set(['x', 'y']), new Set(['y', 'z'])); // 1 / 3
 * jaccardSimilarity(new Set(['x']), new Set(['x']));            // 1
 * jaccardSimilarity(new Set(), new Set());                       // 0
 * ```
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 0;
  }

  let intersectionSize = 0;
  // Iterate over the smaller set for efficiency
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of smaller) {
    if (larger.has(value)) {
      intersectionSize++;
    }
  }

  const unionSize = a.size + b.size - intersectionSize;
  if (unionSize === 0) {
    return 0;
  }

  return intersectionSize / unionSize;
}

/**
 * Jaccard distance: `1 - jaccardSimilarity(a, b)`.
 *
 * Useful as a clustering distance metric. Returns 1 when both inputs
 * are empty (mirroring the similarity convention — maximally distant).
 *
 * @param a - First set
 * @param b - Second set
 * @returns Distance in [0, 1]
 *
 * @example
 * ```typescript
 * jaccardDistance(new Set(['x']), new Set(['x'])); // 0
 * jaccardDistance(new Set(['x']), new Set(['y'])); // 1
 * ```
 */
export function jaccardDistance(a: Set<string>, b: Set<string>): number {
  return 1 - jaccardSimilarity(a, b);
}
