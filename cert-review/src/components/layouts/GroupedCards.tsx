'use client';

import { useState } from 'react';
import type { ReviewItem } from '@/lib/types';
import { cn, getOverallRisk, getNestedValue } from '@/lib/utils';
import ReviewItemCard from '@/components/ReviewItem';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface GroupedCardsProps {
  items: ReviewItem[];
  groupBy: string;
  expandedByDefault?: boolean;
  onDecide: (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => void;
}

/**
 * Resolve the grouping value for a review item based on the groupBy field.
 */
function resolveGroupValue(item: ReviewItem, groupBy: string): string {
  switch (groupBy) {
    case 'principal.email':
      return item.principalProfile?.email ?? 'Unknown';
    case 'principal.firstName':
    case 'principal.name':
      return `${item.principalProfile?.firstName ?? ''} ${item.principalProfile?.lastName ?? ''}`.trim() || 'Unknown';
    case 'resource.name':
    case 'resource':
      return item.reviewItemContextualInfo?.appInfo?.label ?? 'Unknown';
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

interface GroupSectionProps {
  groupName: string;
  items: ReviewItem[];
  defaultExpanded: boolean;
  onDecide: (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => void;
}

function GroupSection({ groupName, items, defaultExpanded, onDecide }: GroupSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50">
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
          <span className="text-sm font-medium text-gray-100">{groupName}</span>
        </div>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-gray-800 px-4 py-3">
          {items.map((item) => (
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
  // Build groups preserving insertion order
  const groupMap = new Map<string, ReviewItem[]>();
  for (const item of items) {
    const key = resolveGroupValue(item, groupBy);
    const arr = groupMap.get(key);
    if (arr) {
      arr.push(item);
    } else {
      groupMap.set(key, [item]);
    }
  }

  const groups = Array.from(groupMap.entries());

  return (
    <div className="space-y-3">
      {groups.map(([name, groupItems]) => (
        <GroupSection
          key={name}
          groupName={name}
          items={groupItems}
          defaultExpanded={expandedByDefault}
          onDecide={onDecide}
        />
      ))}

      {groups.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500">
          No review items found.
        </div>
      )}
    </div>
  );
}
