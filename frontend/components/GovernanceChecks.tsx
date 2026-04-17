/**
 * GovernanceChecks Component
 *
 * Full-screen modal that displays pending governance items on login:
 * - Pending access requests (awaiting approval)
 * - Assigned reviews (access certifications needing decision)
 * - Inactive apps (not used in 60+ days) with one-click removal
 *
 * Shown once per session on initial login, dismissed via sessionStorage flag.
 */

'use client';

import { useEffect, useState } from 'react';
import { uiConfig } from '@/lib/ui-config';

interface PendingRequest {
  id: string;
  appName: string;
  resourceName: string;
  status: string;
  created: string;
  lastUpdated: string;
}

interface AssignedReview {
  id: string;
  campaignId: string;
  campaignName: string;
  pendingReviewCount: number;
  status: string;
  dueDate: string | null;
}

interface InactiveApp {
  appId: string;
  appName: string;
  lastAccess: string | null;
  daysSinceLastAccess: number;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: string;
}

interface GovernanceChecksProps {
  onDismiss: () => void;
}

export default function GovernanceChecks({ onDismiss }: GovernanceChecksProps) {
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [assignedReviews, setAssignedReviews] = useState<AssignedReview[]>([]);
  const [inactiveApps, setInactiveApps] = useState<InactiveApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingApps, setRemovingApps] = useState<Set<string>>(new Set());

  useEffect(() => {
    console.log('[GovernanceChecks] Component mounted');
    fetchGovernanceItems();
  }, []);

  const fetchGovernanceItems = async () => {
    try {
      setLoading(true);

      // Fetch all three types of governance items in parallel
      const [requestsRes, reviewsRes, appsRes] = await Promise.all([
        fetch('/api/governance/pending-requests'),
        fetch('/api/governance/assigned-reviews'),
        fetch('/api/governance/inactive-apps'),
      ]);

      let requestsCount = 0;
      let reviewsCount = 0;
      let appsCount = 0;

      if (requestsRes.ok) {
        const requests = await requestsRes.json();
        if (Array.isArray(requests)) {
          setPendingRequests(requests);
          requestsCount = requests.length;
        }
      }

      if (reviewsRes.ok) {
        const reviews = await reviewsRes.json();
        if (Array.isArray(reviews)) {
          setAssignedReviews(reviews);
          reviewsCount = reviews.length;
        }
      }

      if (appsRes.ok) {
        const apps = await appsRes.json();
        if (Array.isArray(apps)) {
          setInactiveApps(apps);
          appsCount = apps.length;
        }
      }

      console.log('[GovernanceChecks] Fetched items:', {
        pendingRequests: requestsCount,
        assignedReviews: reviewsCount,
        inactiveApps: appsCount,
      });
    } catch (err) {
      console.error('[GovernanceChecks] Error:', err);
      setError('Failed to load governance items');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAccess = async (appId: string, appName: string) => {
    if (removingApps.has(appId)) return;

    const confirmed = window.confirm(
      `Are you sure you want to remove your access to ${appName}? This will create a self-review campaign for you to confirm the removal.`
    );

    if (!confirmed) return;

    setRemovingApps(new Set(removingApps).add(appId));

    try {
      const response = await fetch('/api/governance/remove-app-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId }),
      });

      if (!response.ok) {
        throw new Error('Failed to remove access');
      }

      const result = await response.json();

      if (result.success) {
        alert(`Success! Campaign created to remove your access to ${appName}. You can complete the review in your access certification dashboard.`);

        // Remove the app from the inactive apps list
        setInactiveApps(inactiveApps.filter(app => app.appId !== appId));
      } else {
        throw new Error(result.error?.message || 'Failed to remove access');
      }
    } catch (err) {
      console.error('[GovernanceChecks] Error removing access:', err);
      alert(`Failed to remove access: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setRemovingApps(new Set([...removingApps].filter(id => id !== appId)));
    }
  };

  const handleDismiss = () => {
    // Set sessionStorage flag to prevent showing again this session
    sessionStorage.setItem('governanceChecked', 'true');
    onDismiss();
  };

  // Calculate total items
  const totalItems = pendingRequests.length + assignedReviews.length + inactiveApps.length;

  // If loading, show spinner
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
          <p className="text-center mt-4 text-gray-600">Checking governance items...</p>
        </div>
      </div>
    );
  }

  // If no items, don't show the modal
  if (totalItems === 0 && !error) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div
          className="p-6 border-b"
          style={{ borderColor: uiConfig.colors.gray200 }}
        >
          <h2 className="text-2xl font-bold" style={{ color: uiConfig.colors.gray900 }}>
            Governance Items Pending
          </h2>
          <p className="text-sm mt-2" style={{ color: uiConfig.colors.gray600 }}>
            You have {totalItems} item{totalItems !== 1 ? 's' : ''} requiring your attention
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {/* Pending Access Requests */}
          {pendingRequests.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3" style={{ color: uiConfig.colors.gray900 }}>
                📋 Pending Access Requests ({pendingRequests.length})
              </h3>
              <div className="space-y-2">
                {pendingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="p-4 rounded-lg border"
                    style={{
                      backgroundColor: uiConfig.colors.gray50,
                      borderColor: uiConfig.colors.gray200,
                    }}
                  >
                    <p className="font-medium" style={{ color: uiConfig.colors.gray900 }}>
                      {request.appName}
                    </p>
                    <p className="text-sm mt-1" style={{ color: uiConfig.colors.gray600 }}>
                      Status: {request.status} • Requested {new Date(request.created).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assigned Reviews */}
          {assignedReviews.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3" style={{ color: uiConfig.colors.gray900 }}>
                ✅ Reviews Assigned to You ({assignedReviews.length})
              </h3>
              <div className="space-y-2">
                {assignedReviews.map((review) => (
                  <div
                    key={review.id}
                    className="p-4 rounded-lg border"
                    style={{
                      backgroundColor: uiConfig.colors.gray50,
                      borderColor: uiConfig.colors.gray200,
                    }}
                  >
                    <p className="font-medium" style={{ color: uiConfig.colors.gray900 }}>
                      {review.campaignName}
                    </p>
                    <p className="text-sm mt-1" style={{ color: uiConfig.colors.gray600 }}>
                      {review.pendingReviewCount} pending review{review.pendingReviewCount !== 1 ? 's' : ''}
                      {review.dueDate && ` • Due ${new Date(review.dueDate).toLocaleDateString()}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inactive Apps */}
          {inactiveApps.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3" style={{ color: uiConfig.colors.gray900 }}>
                ⚠️ Unused Apps ({inactiveApps.length})
              </h3>
              <p className="text-sm mb-3" style={{ color: uiConfig.colors.gray600 }}>
                You haven't used these apps in over 60 days. Consider removing access to reduce your security footprint.
              </p>
              <div className="space-y-3">
                {inactiveApps.map((app) => (
                  <div
                    key={app.appId}
                    className="p-4 rounded-lg border"
                    style={{
                      backgroundColor: uiConfig.colors.gray50,
                      borderColor: uiConfig.colors.gray200,
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium" style={{ color: uiConfig.colors.gray900 }}>
                          {app.appName}
                        </p>
                        <p className="text-sm mt-1" style={{ color: uiConfig.colors.gray600 }}>
                          Last used: {app.lastAccess ? new Date(app.lastAccess).toLocaleDateString() : 'Never'}
                          ({app.daysSinceLastAccess} days ago)
                        </p>
                        <span
                          className={`inline-block mt-2 px-2 py-1 text-xs font-semibold rounded ${
                            app.riskLevel === 'HIGH'
                              ? 'bg-red-100 text-red-800'
                              : app.riskLevel === 'MEDIUM'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {app.riskLevel} RISK
                        </span>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleRemoveAccess(app.appId, app.appName)}
                          disabled={removingApps.has(app.appId)}
                          className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {removingApps.has(app.appId) ? 'Removing...' : 'Remove Access'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="p-6 border-t flex justify-end"
          style={{ borderColor: uiConfig.colors.gray200 }}
        >
          <button
            onClick={handleDismiss}
            className="px-6 py-2 text-sm font-medium text-white rounded-lg transition-colors"
            style={{
              backgroundColor: uiConfig.colors.primary,
            }}
          >
            Dismiss All
          </button>
        </div>
      </div>
    </div>
  );
}
