'use client';

import { useState } from 'react';
import type { ReviewItem } from '@/lib/types';
import { cn, getOverallRisk, getNestedValue } from '@/lib/utils';
import ReviewItemCard from '@/components/ReviewItem';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface GroupedCardsProps {
  items: ReviewItem[];
  groupBy: string | string[];
  expandedByDefault?: boolean;
  onDecide: (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => void;
}

/**
 * Resolve the grouping value for a review item based on a field name.
 */
function resolveGroupValue(item: ReviewItem, groupBy: string): string {
  switch (groupBy) {
    case 'principal.email':
      return item.principalProfile?.email ?? 'Unknown';
    case 'principal.firstName':
    case 'principal.lastName':
    case 'principal.name':
      return `${item.principalProfile?.firstName ?? ''} ${item.principalProfile?.lastName ?? ''}`.trim() || 'Unknown';
    case 'resource.name':
    case 'resource':
      return item.reviewItemContextualInfo?.appInfo?.label ?? 'Unknown';
    case 'entitlement':
    case 'entitlements':
      const ents = item.reviewItemContextualInfo?.appInfo?.activeEntitlements;
      if (ents && ents.length > 0) {
        return ents.map(e => e.values?.map(v => v.name).join(', ') || e.name).join('; ');
      }
      return 'No entitlements';
    case 'riskLevel':
      return getOverallRisk(item.riskItems || []);
    case 'decision':
      return item.decision;
    case 'assignmentType':
      return item.assignmentType ?? 'Unknown';
    case 'recommendation':
      return item.govAnalyzerRecommendationContext?.recommendedReviewDecision ?? 'None';
    default:
      return String(getNestedValue(item, groupBy) ?? 'Unknown');
  }
}

/**
 * Recursively group items by multiple fields.
 * Returns a tree structure: { key, items?, children? }
 */
interface GroupNode {
  key: string;
  items?: ReviewItem[];
  children?: GroupNode[];
}

function buildGroupTree(items: ReviewItem[], groupFields: string[]): GroupNode[] {
  if (groupFields.length === 0) return [];

  const [currentField, ...remainingFields] = groupFields;
  const groupMap = new Map<string, ReviewItem[]>();

  for (const item of items) {
    const key = resolveGroupValue(item, currentField);
    const arr = groupMap.get(key);
    if (arr) arr.push(item);
    else groupMap.set(key, [item]);
  }

  return Array.from(groupMap.entries()).map(([key, groupItems]) => {
    if (remainingFields.length > 0) {
      return {
        key,
        children: buildGroupTree(groupItems, remainingFields),
      };
    }
    return { key, items: groupItems };
  });
}

interface GroupSectionProps {
  node: GroupNode;
  depth: number;
  defaultExpanded: boolean;
  onDecide: (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => void;
}

function GroupSection({ node, depth, defaultExpanded, onDecide }: GroupSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const itemCount = node.items?.length ??
    node.children?.reduce((sum, c) => sum + (c.items?.length ?? c.children?.reduce((s, cc) => s + (cc.items?.length ?? 0), 0) ?? 0), 0) ?? 0;

  const depthColors = [
    'border-blue-500/30 bg-gray-900/60',
    'border-purple-500/30 bg-gray-900/40',
    'border-teal-500/30 bg-gray-900/20',
  ];

  return (
    <div className={cn(
      'rounded-lg border',
      depthColors[depth % depthColors.length] || 'border-gray-800 bg-gray-900/50',
      depth > 0 && 'ml-4'
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-800/40"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
          <span className={cn(
            'font-medium text-gray-100',
            depth === 0 ? 'text-sm' : 'text-xs'
          )}>
            {node.key}
          </span>
        </div>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-gray-800/50 px-4 py-3">
          {node.children?.map((child) => (
            <GroupSection
              key={child.key}
              node={child}
              depth={depth + 1}
              defaultExpanded={depth < 1 ? defaultExpanded : false}
              onDecide={onDecide}
            />
          ))}
          {node.items?.map((item) => (
            <ReviewItemCard key={item.id} item={item} onDecide={onDecide} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function GroupedCards({
  items,
  groupBy,
  expandedByDefault = true,
  onDecide,
}: GroupedCardsProps) {
  const groupFields = Array.isArray(groupBy) ? groupBy : [groupBy];
  const tree = buildGroupTree(items, groupFields);

  return (
    <div className="space-y-3 p-4">
      {tree.map((node) => (
        <GroupSection
          key={node.key}
          node={node}
          depth={0}
          defaultExpanded={expandedByDefault}
          onDecide={onDecide}
        />
      ))}

      {tree.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500">
          No review items found.
        </div>
      )}
    </div>
  );
}
