'use client';

import type { ReviewItem as ReviewItemType } from '@/lib/types';
import { cn, formatRiskReason, getOverallRisk } from '@/lib/utils';
import RiskBadge from './RiskBadge';
import DecisionButtons from './DecisionButtons';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

interface ReviewItemProps {
  item: ReviewItemType;
  onDecide: (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => void;
  showDetail?: boolean;
}

export default function ReviewItemCard({ item, onDecide, showDetail }: ReviewItemProps) {
  const appInfo = item.reviewItemContextualInfo?.appInfo;
  const userInfo = item.reviewItemContextualInfo?.userInfo;
  const overallRisk = getOverallRisk(item.riskItems || []);
  const recommendation = item.govAnalyzerRecommendationContext?.recommendedReviewDecision;
  const entitlements = appInfo?.activeEntitlements ?? [];

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      {/* Top row: principal, resource, risk, recommendation, decision */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Principal */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-100">
            {item.principalProfile.firstName} {item.principalProfile.lastName}
          </p>
          <p className="truncate text-xs text-gray-400">{item.principalProfile.email}</p>
        </div>

        {/* Resource */}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-400">Resource</p>
          <p className="truncate text-sm text-gray-200">{appInfo?.label ?? 'N/A'}</p>
        </div>

        {/* Entitlements */}
        {entitlements.length > 0 && (
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400">Entitlements</p>
            <div className="mt-0.5 flex flex-wrap gap-1">
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
            </div>
          </div>
        )}

        {/* Badges */}
        <div className="flex items-center gap-2">
          <RiskBadge level={overallRisk} />
          {recommendation && (
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
              AI: {recommendation}
            </span>
          )}
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
            {item.assignmentType}
          </span>
        </div>

        {/* Decision */}
        <div className="flex-shrink-0">
          <DecisionButtons
            reviewItemId={item.id}
            campaignId={item.campaignId}
            reviewerLevelId={item.currReviewerLevel}
            currentDecision={item.decision}
            onDecide={onDecide}
          />
        </div>
      </div>

      {/* Detail section */}
      {showDetail && (
        <div className="mt-4 space-y-3 border-t border-gray-800 pt-4">
          {/* Risk items */}
          {item.riskItems.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-300">Risk Analysis</p>
              <div className="space-y-1">
                {item.riskItems.map((ri, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'flex items-start gap-2 rounded px-2 py-1.5 text-xs',
                      ri.riskLevel === 'HIGH'
                        ? 'bg-red-500/5 text-red-300'
                        : ri.riskLevel === 'MEDIUM'
                          ? 'bg-yellow-500/5 text-yellow-300'
                          : 'bg-green-500/5 text-green-300',
                    )}
                  >
                    <RiskBadge level={ri.riskLevel} />
                    <span>
                      <span className="font-medium">{ri.riskLabel}:</span>{' '}
                      {formatRiskReason(ri.reason.message, ri.reason.args)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Group memberships */}
          {appInfo?.groupMembershipAssignedTo && appInfo.groupMembershipAssignedTo.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-300">Assigned via Groups</p>
              <div className="flex flex-wrap gap-1">
                {appInfo.groupMembershipAssignedTo.map((g) => (
                  <span
                    key={g.id}
                    className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-4 text-xs text-gray-400">
            {appInfo?.assignedDate && (
              <span>
                Assigned: {new Date(appInfo.assignedDate).toLocaleDateString()}
              </span>
            )}
            {appInfo?.applicationUsage !== undefined && (
              <span>Usage count: {appInfo.applicationUsage}</span>
            )}
            {userInfo?.userStatus && <span>User status: {userInfo.userStatus}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
