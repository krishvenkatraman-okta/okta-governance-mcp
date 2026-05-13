'use client';

import type { ReviewItem } from '@/lib/types';
import { cn, getOverallRisk } from '@/lib/utils';
import RiskBadge from '@/components/RiskBadge';
import DecisionButtons from '@/components/DecisionButtons';
import { ChevronDown, ChevronRight, ThumbsUp, ThumbsDown } from 'lucide-react';

interface FlatTableProps {
  items: ReviewItem[];
  columns?: string[];
  sortBy?: string;
  sortOrder?: string;
  onDecide: (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => void;
  onSort: (field: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
}

interface ColumnDef {
  key: string;
  label: string;
  sortable: boolean;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'select', label: '', sortable: false },
  { key: 'principal', label: 'Principal', sortable: true },
  { key: 'resource', label: 'Resource', sortable: true },
  { key: 'entitlements', label: 'Entitlements', sortable: false },
  { key: 'riskLevel', label: 'Risk', sortable: true },
  { key: 'recommendation', label: 'Recommendation', sortable: true },
  { key: 'decision', label: 'Decision', sortable: true },
];

function SortIcon({ field, sortBy, sortOrder }: { field: string; sortBy?: string; sortOrder?: string }) {
  if (field !== sortBy) {
    return <ChevronRight className="ml-1 inline h-3 w-3 text-gray-600" />;
  }
  return sortOrder === 'DESC' ? (
    <ChevronDown className="ml-1 inline h-3 w-3 text-gray-300" />
  ) : (
    <ChevronDown className="ml-1 inline h-3 w-3 rotate-180 text-gray-300" />
  );
}

export default function FlatTable({
  items,
  columns,
  sortBy,
  sortOrder,
  onDecide,
  onSort,
  selectedIds,
  onToggleSelect,
  onSelectAll,
}: FlatTableProps) {
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900">
            {DEFAULT_COLUMNS.map((col) => (
              <th key={col.key} className="px-3 py-2.5 text-xs font-medium text-gray-400">
                {col.key === 'select' ? (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onSelectAll}
                    className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 accent-blue-500"
                  />
                ) : col.sortable ? (
                  <button
                    onClick={() => onSort(col.key)}
                    className="inline-flex items-center hover:text-gray-200"
                  >
                    {col.label}
                    <SortIcon field={col.key} sortBy={sortBy} sortOrder={sortOrder} />
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const appInfo = item.reviewItemContextualInfo?.appInfo;
            const overallRisk = getOverallRisk(item.riskItems || []);
            const recommendation =
              item.govAnalyzerRecommendationContext?.recommendedReviewDecision;
            const entitlements = appInfo?.activeEntitlements ?? [];

            return (
              <tr
                key={item.id}
                className={cn(
                  'border-b border-gray-800/50 transition-colors hover:bg-gray-800/40',
                  idx % 2 === 0 ? 'bg-gray-950' : 'bg-gray-900/30',
                  selectedIds.has(item.id) && 'bg-blue-500/5',
                )}
              >
                {/* Checkbox */}
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => onToggleSelect(item.id)}
                    className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 accent-blue-500"
                  />
                </td>

                {/* Principal */}
                <td className="px-3 py-2.5">
                  <p className="text-sm text-gray-100">
                    {item.principalProfile.firstName} {item.principalProfile.lastName}
                  </p>
                  <p className="text-xs text-gray-500">{item.principalProfile.email}</p>
                </td>

                {/* Resource */}
                <td className="px-3 py-2.5 text-sm text-gray-200">
                  {appInfo?.label ?? 'N/A'}
                </td>

                {/* Entitlements */}
                <td className="max-w-48 px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {entitlements.flatMap((es) =>
                      es.values.map((v) => (
                        <span
                          key={v.id}
                          className="inline-block truncate rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300"
                        >
                          {v.name}
                        </span>
                      )),
                    )}
                    {entitlements.length === 0 && (
                      <span className="text-xs text-gray-600">--</span>
                    )}
                  </div>
                </td>

                {/* Risk */}
                <td className="px-3 py-2.5">
                  <RiskBadge level={overallRisk} />
                </td>

                {/* Recommendation */}
                <td className="px-3 py-2.5">
                  {recommendation ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
                        recommendation === 'APPROVE'
                          ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                          : 'border-orange-500/30 bg-orange-500/10 text-orange-400',
                      )}
                    >
                      {recommendation === 'APPROVE' ? (
                        <ThumbsUp className="h-3 w-3" />
                      ) : (
                        <ThumbsDown className="h-3 w-3" />
                      )}
                      {recommendation}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600">--</span>
                  )}
                </td>

                {/* Decision */}
                <td className="px-3 py-2.5">
                  <DecisionButtons
                    reviewItemId={item.id}
                    campaignId={item.campaignId}
                    reviewerLevelId={item.currReviewerLevel}
                    currentDecision={item.decision}
                    onDecide={onDecide}
                  />
                </td>
              </tr>
            );
          })}

          {items.length === 0 && (
            <tr>
              <td colSpan={DEFAULT_COLUMNS.length} className="py-12 text-center text-sm text-gray-500">
                No review items found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
