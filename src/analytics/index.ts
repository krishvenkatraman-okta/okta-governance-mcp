/**
 * Analytics barrel
 *
 * Single import point for the analytics layer:
 *   import { buildAccessGraph, jaccardSimilarity, computePeerGroups }
 *     from '../analytics/index.js';
 */

export * from './types.js';
export * from './jaccard.js';
export * from './access-graph.js';
export * from './peer-grouper.js';
