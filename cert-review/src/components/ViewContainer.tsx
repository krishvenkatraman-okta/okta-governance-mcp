'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ViewConfig, Campaign, ReviewItem } from '@/lib/types';
import { applyFilters } from '@/lib/utils';

// Layout imports
import CampaignOverview from './layouts/CampaignOverview';
import FlatTable from './layouts/FlatTable';
import GroupedCards from './layouts/GroupedCards';
import RiskDashboard from './layouts/RiskDashboard';
import SplitDetail from './layouts/SplitDetail';
import BulkActions from './BulkActions';

interface ViewContainerProps {
  viewConfig: ViewConfig;
  campaigns: Campaign[];
  items: ReviewItem[];
  itemsLoading: boolean;
  onSelectCampaign: (id: string) => void;
  onDecide: (campaignId: string, reviewItemId: string, decision: 'APPROVE' | 'REVOKE', reviewerLevelId: string, note: string) => void;
}

export function ViewContainer({
  viewConfig,
  campaigns,
  items,
  itemsLoading,
  onSelectCampaign,
  onDecide,
}: ViewContainerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState(viewConfig.sortBy || '');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>(viewConfig.sortOrder || 'ASC');

  // Apply filters from view config
  const filteredItems = useMemo(() => {
    let result = items;
    if (viewConfig.filter && Object.keys(viewConfig.filter).length > 0) {
      result = applyFilters(result, viewConfig.filter);
    }
    return result;
  }, [items, viewConfig.filter]);

  // Sort
  const sortedItems = useMemo(() => {
    if (!sortBy) return filteredItems;
    return [...filteredItems].sort((a, b) => {
      let aVal = '', bVal = '';
      switch (sortBy) {
        case 'principal.firstName':
        case 'principal.email':
          aVal = a.principalProfile?.email || '';
          bVal = b.principalProfile?.email || '';
          break;
        case 'decision':
          aVal = a.decision;
          bVal = b.decision;
          break;
        case 'recommendation':
          aVal = a.govAnalyzerRecommendationContext?.recommendedReviewDecision || '';
          bVal = b.govAnalyzerRecommendationContext?.recommendedReviewDecision || '';
          break;
        default:
          aVal = String(a[sortBy as keyof ReviewItem] || '');
          bVal = String(b[sortBy as keyof ReviewItem] || '');
      }
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === 'DESC' ? -cmp : cmp;
    });
  }, [filteredItems, sortBy, sortOrder]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(field);
      setSortOrder('ASC');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedItems.map(i => i.id)));
    }
  };

  const handleBulkDecide = async (decision: 'APPROVE' | 'REVOKE', note: string) => {
    for (const id of selectedIds) {
      const item = items.find(i => i.id === id);
      if (item && item.decision === 'UNREVIEWED') {
        await onDecide(item.campaignId, id, decision, item.currReviewerLevel || 'ONE', note);
      }
    }
    setSelectedIds(new Set());
  };

  const handleDecide = (campaignId: string, reviewItemId: string, decision: 'APPROVE' | 'REVOKE', reviewerLevelId: string, note: string) => {
    onDecide(campaignId, reviewItemId, decision, reviewerLevelId, note);
  };

  // Simplified callback for layout components: (id, decision, note) → full signature
  const handleItemDecide = (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => {
    const item = items.find(i => i.id === id);
    if (item) {
      handleDecide(item.campaignId, id, decision, item.currReviewerLevel || 'ONE', note);
    }
  };

  if (itemsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        <span className="ml-3 text-gray-400">Loading review items...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">
            {viewConfig.title || 'Access Certification Review'}
          </h1>
          {viewConfig.layout !== 'campaign-overview' && (
            <p className="text-sm text-gray-500 mt-0.5">
              {sortedItems.length} items
              {viewConfig.filter && Object.keys(viewConfig.filter).length > 0 && ' (filtered)'}
            </p>
          )}
        </div>
        {selectedIds.size > 0 && (
          <BulkActions
            selectedCount={selectedIds.size}
            onBulkDecide={handleBulkDecide}
            onClear={() => setSelectedIds(new Set())}
          />
        )}
      </div>

      {/* Debug info - remove after testing */}
      {process.env.NODE_ENV !== 'production' || true ? (
        <div className="px-6 py-2 text-xs text-gray-600 border-b border-gray-800 font-mono">
          layout={viewConfig.layout} | campaigns={campaigns.length} | items={sortedItems.length} | campaignId={viewConfig.campaignId || 'none'}
        </div>
      ) : null}

      {/* Layout */}
      <div className="flex-1 overflow-auto">
        {viewConfig.layout === 'campaign-overview' && (
          <CampaignOverview campaigns={campaigns} onSelectCampaign={onSelectCampaign} />
        )}
        {viewConfig.layout === 'flat-table' && (
          <FlatTable
            items={sortedItems}
            columns={viewConfig.columns}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onDecide={handleItemDecide}
            onSort={handleSort}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectAll={toggleSelectAll}
          />
        )}
        {viewConfig.layout === 'grouped-cards' && (
          <GroupedCards
            items={sortedItems}
            groupBy={viewConfig.groupBy || 'resource.name'}
            expandedByDefault={viewConfig.expandedByDefault}
            onDecide={handleItemDecide}
          />
        )}
        {viewConfig.layout === 'risk-dashboard' && (
          <RiskDashboard items={sortedItems} onDecide={handleItemDecide} />
        )}
        {viewConfig.layout === 'split-detail' && (
          <SplitDetail items={sortedItems} onDecide={handleItemDecide} />
        )}
      </div>
    </div>
  );
}
