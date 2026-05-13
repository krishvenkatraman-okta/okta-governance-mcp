'use client';

import type { ReviewItem } from '@/lib/types';
import { cn, getOverallRisk } from '@/lib/utils';
import ReviewItemCard from '@/components/ReviewItem';
import { AlertTriangle, Shield } from 'lucide-react';

interface RiskDashboardProps {
  items: ReviewItem[];
  onDecide: (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => void;
}

const RISK_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export default function RiskDashboard({ items, onDecide }: RiskDashboardProps) {
  // Compute risk for each item
  const itemsWithRisk = items.map((item) => ({
    item,
    risk: getOverallRisk(item.riskItems || []),
  }));

  // Count by level
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const { risk } of itemsWithRisk) {
    counts[risk]++;
  }

  // Sort by risk (HIGH first)
  const sorted = [...itemsWithRisk].sort(
    (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk],
  );

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border-l-4 border-l-red-500 border-r border-t border-b border-r-gray-800 border-t-gray-800 border-b-gray-800 bg-gray-900 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <span className="text-sm font-medium text-gray-300">High Risk</span>
          </div>
          <p className="mt-2 text-3xl font-bold text-red-400">{counts.HIGH}</p>
          <p className="text-xs text-gray-500">items requiring attention</p>
        </div>

        <div className="rounded-lg border-l-4 border-l-yellow-500 border-r border-t border-b border-r-gray-800 border-t-gray-800 border-b-gray-800 bg-gray-900 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
            <span className="text-sm font-medium text-gray-300">Medium Risk</span>
          </div>
          <p className="mt-2 text-3xl font-bold text-yellow-400">{counts.MEDIUM}</p>
          <p className="text-xs text-gray-500">items to review</p>
        </div>

        <div className="rounded-lg border-l-4 border-l-green-500 border-r border-t border-b border-r-gray-800 border-t-gray-800 border-b-gray-800 bg-gray-900 p-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-green-400" />
            <span className="text-sm font-medium text-gray-300">Low Risk</span>
          </div>
          <p className="mt-2 text-3xl font-bold text-green-400">{counts.LOW}</p>
          <p className="text-xs text-gray-500">items looking good</p>
        </div>
      </div>

      {/* Items sorted by risk */}
      <div className="space-y-3">
        {sorted.map(({ item, risk }) => (
          <div
            key={item.id}
            className={cn(
              'rounded-lg',
              risk === 'HIGH' && 'border-l-4 border-l-red-500',
              risk === 'MEDIUM' && 'border-l-4 border-l-yellow-500',
              risk === 'LOW' && 'border-l-4 border-l-green-500/50',
            )}
          >
            <ReviewItemCard item={item} onDecide={onDecide} showDetail />
          </div>
        ))}

        {sorted.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">
            No review items found.
          </div>
        )}
      </div>
    </div>
  );
}
