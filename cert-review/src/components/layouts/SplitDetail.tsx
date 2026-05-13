'use client';

import { useState } from 'react';
import type { ReviewItem } from '@/lib/types';
import { cn, getOverallRisk } from '@/lib/utils';
import ReviewItemCard from '@/components/ReviewItem';
import RiskBadge from '@/components/RiskBadge';

interface SplitDetailProps {
  items: ReviewItem[];
  onDecide: (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => void;
}

export default function SplitDetail({ items, onDecide }: SplitDetailProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100vh-12rem)] gap-4">
      {/* Left panel - item list */}
      <div className="w-2/5 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900">
        {items.map((item) => {
          const appInfo = item.reviewItemContextualInfo?.appInfo;
          const risk = getOverallRisk(item.riskItems || []);
          const isSelected = item.id === selectedId;

          return (
            <button
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={cn(
                'flex w-full items-center gap-3 border-b border-gray-800/50 px-4 py-3 text-left transition-colors',
                isSelected
                  ? 'bg-gray-800'
                  : 'hover:bg-gray-800/40',
              )}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'truncate text-sm font-medium',
                    isSelected ? 'text-white' : 'text-gray-200',
                  )}
                >
                  {item.principalProfile.firstName} {item.principalProfile.lastName}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {appInfo?.label ?? 'N/A'}
                </p>
              </div>
              <RiskBadge level={risk} />
            </button>
          );
        })}

        {items.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">
            No review items found.
          </div>
        )}
      </div>

      {/* Right panel - detail */}
      <div className="w-3/5 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900 p-4">
        {selectedItem ? (
          <ReviewItemCard item={selectedItem} onDecide={onDecide} showDetail />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Select a review item to see details
          </div>
        )}
      </div>
    </div>
  );
}
