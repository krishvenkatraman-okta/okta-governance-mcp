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
export * from './role-miner.js';
// `outlier-detector` and `role-miner` both export `DEFAULT_MAX_RESULTS`;
// re-export the outlier-detector members explicitly to avoid the collision.
export {
  DEFAULT_OUTLIER_THRESHOLD,
  DEFAULT_PEER_GROUPING_STRATEGY,
  DEFAULT_MAX_RESULTS as DEFAULT_OUTLIER_MAX_RESULTS,
  detectOutliers,
} from './outlier-detector.js';
export type {
  DetectOutliersOptions,
  OutlierEntitlement,
  OutlierUser,
  OutlierRecommendation,
  OutlierResult,
} from './outlier-detector.js';
export * from './access-explainer.js';
export * from './campaign-builder.js';
