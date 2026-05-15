'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Campaign, ReviewItem } from '@/lib/types';

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/campaigns')
      .then(res => res.json())
      .then(data => {
        console.log('[useCampaigns] Response:', JSON.stringify(data).substring(0, 200));
        if (data.error) {
          console.error('[useCampaigns] API error:', data);
          setError(data.error);
        } else {
          setCampaigns(Array.isArray(data) ? data : []);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('[useCampaigns] Fetch error:', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return { campaigns, loading, error };
}

export function useReviewItems(campaignId: string | null) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews?campaignId=${id}&limit=200`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (campaignId) {
      fetchItems(campaignId);
    } else {
      setItems([]);
    }
  }, [campaignId, fetchItems]);

  const submitDecision = useCallback(async (
    campaignId: string,
    reviewItemId: string,
    decision: 'APPROVE' | 'REVOKE',
    reviewerLevelId: string,
    note: string
  ) => {
    const res = await fetch('/api/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId, reviewItemId, decision, reviewerLevelId, note }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Decision failed');
    }

    // Optimistic update
    setItems(prev => prev.map(item =>
      item.id === reviewItemId
        ? { ...item, decision, note: { id: '', note } }
        : item
    ));

    return res.json();
  }, []);

  return { items, loading, error, refetch: fetchItems, submitDecision };
}
