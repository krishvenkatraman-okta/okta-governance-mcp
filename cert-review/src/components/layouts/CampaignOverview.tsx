'use client';

import type { Campaign } from '@/lib/types';
import { cn } from '@/lib/utils';

interface CampaignOverviewProps {
  campaigns: Campaign[];
  onSelectCampaign: (id: string) => void;
}

function statusColor(status: string) {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
    case 'IN_PROGRESS':
      return 'border-green-500/30 bg-green-500/10 text-green-400';
    case 'CLOSED':
    case 'COMPLETED':
      return 'border-gray-500/30 bg-gray-500/10 text-gray-400';
    case 'SCHEDULED':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-400';
    default:
      return 'border-gray-500/30 bg-gray-500/10 text-gray-400';
  }
}

export default function CampaignOverview({ campaigns, onSelectCampaign }: CampaignOverviewProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {campaigns.map((campaign) => {
        const summary = campaign.campaignSummary;
        const total = summary.total || 1;
        const approvedPct = (summary.approved / total) * 100;
        const revokedPct = (summary.revoked / total) * 100;
        const pendingPct = 100 - approvedPct - revokedPct;
        const dueDate = campaign.endDateForReviewerLevel || campaign.endTime;

        return (
          <button
            key={campaign.id}
            onClick={() => onSelectCampaign(campaign.id)}
            className="group cursor-pointer rounded-lg border border-gray-800 bg-gray-900 p-5 text-left transition-colors hover:border-gray-700 hover:bg-gray-800/60"
          >
            {/* Header */}
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-100 group-hover:text-white">
                {campaign.template.name}
              </h3>
              <span
                className={cn(
                  'flex-shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
                  statusColor(campaign.status),
                )}
              >
                {campaign.status}
              </span>
            </div>

            {/* Progress bar */}
            <div className="mb-3">
              <div className="mb-1 flex justify-between text-xs text-gray-400">
                <span>Progress</span>
                <span>
                  {summary.approved + summary.revoked}/{total}
                </span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-gray-800">
                {approvedPct > 0 && (
                  <div
                    className="bg-green-500 transition-all"
                    style={{ width: `${approvedPct}%` }}
                  />
                )}
                {revokedPct > 0 && (
                  <div
                    className="bg-red-500 transition-all"
                    style={{ width: `${revokedPct}%` }}
                  />
                )}
                {pendingPct > 0 && (
                  <div
                    className="bg-gray-700 transition-all"
                    style={{ width: `${pendingPct}%` }}
                  />
                )}
              </div>
            </div>

            {/* Counts */}
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded bg-gray-800/60 p-2">
                <p className="text-lg font-semibold text-yellow-400">{summary.pending}</p>
                <p className="text-xs text-gray-500">Pending</p>
              </div>
              <div className="rounded bg-gray-800/60 p-2">
                <p className="text-lg font-semibold text-green-400">{summary.approved}</p>
                <p className="text-xs text-gray-500">Approved</p>
              </div>
              <div className="rounded bg-gray-800/60 p-2">
                <p className="text-lg font-semibold text-red-400">{summary.revoked}</p>
                <p className="text-xs text-gray-500">Revoked</p>
              </div>
            </div>

            {/* Due date */}
            {dueDate && (
              <p className="text-xs text-gray-500">
                Due: {new Date(dueDate).toLocaleDateString()}
              </p>
            )}
          </button>
        );
      })}

      {campaigns.length === 0 && (
        <div className="col-span-full py-12 text-center text-sm text-gray-500">
          No campaigns found.
        </div>
      )}
    </div>
  );
}
