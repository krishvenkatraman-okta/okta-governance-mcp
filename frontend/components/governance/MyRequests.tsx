/**
 * MyRequests Component
 *
 * Displays the authenticated user's access requests from Okta Governance.
 *
 * Features:
 * - Fetches requests from /api/governance/me/requests
 * - Shows loading skeleton while fetching
 * - Shows empty state if no requests
 * - Displays request details: name, status, date, target resources
 * - Error handling with user-friendly messages
 *
 * Status badges:
 * - PENDING: Yellow
 * - APPROVED: Green
 * - REJECTED: Red
 * - FULFILLED: Gray
 */

'use client';

import { useEffect, useState } from 'react';

interface AccessRequest {
  id: string;
  displayName?: string;
  name?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED';
  createdAt: string;
  targetResources?: Array<{ id: string; displayName?: string; name?: string }>;
}

interface ApiResponse {
  data: AccessRequest[];
  error?: {
    code: string;
    message: string;
    scope?: string;
  };
}

export function MyRequests() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRequests() {
      try {
        const res = await fetch('/api/governance/me/requests');
        const data: ApiResponse = await res.json();

        if (data.error) {
          if (data.error.code === 'INSUFFICIENT_SCOPE') {
            setError(`Missing permission: ${data.error.scope}`);
          } else {
            setError(data.error.message);
          }
        } else {
          setRequests(data.data || []);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch requests');
      } finally {
        setLoading(false);
      }
    }

    fetchRequests();
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-32 bg-gray-200 rounded-lg"></div>
        <div className="h-32 bg-gray-200 rounded-lg"></div>
        <div className="h-32 bg-gray-200 rounded-lg"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-800 font-semibold">Error Loading Requests</p>
        <p className="text-red-600 text-sm mt-2">{error}</p>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 border border-gray-200 rounded-lg">
        <p className="font-medium">No access requests yet.</p>
        <p className="text-sm mt-2">Ready to request access? Browse catalogs to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => (
        <div key={req.id} className="p-4 border border-gray-200 rounded-lg bg-white shadow-sm">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h3 className="font-semibold text-lg text-gray-900">
                {req.displayName || req.name || 'Unnamed Request'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Requested: {new Date(req.createdAt).toLocaleDateString()}
              </p>

              {req.targetResources && req.targetResources.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-sm font-medium text-gray-700">Target Resources:</p>
                  {req.targetResources.map((res) => (
                    <p key={res.id} className="text-sm text-gray-600 ml-2">
                      → {res.displayName || res.name || res.id}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <StatusBadge status={req.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    APPROVED: 'bg-green-100 text-green-800 border-green-300',
    REJECTED: 'bg-red-100 text-red-800 border-red-300',
    FULFILLED: 'bg-gray-100 text-gray-800 border-gray-300',
    PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  };

  const style = styles[status] || 'bg-gray-100 text-gray-800 border-gray-300';

  return (
    <span
      className={`ml-4 px-3 py-1 text-xs font-semibold rounded-full border ${style}`}
    >
      {status}
    </span>
  );
}
