'use client';

import { useEffect } from 'react';
import { ChatPanel } from '@/components/ChatPanel';
import { ViewContainer } from '@/components/ViewContainer';
import { useCampaigns, useReviewItems } from '@/hooks/useReviews';
import { useChat } from '@/hooks/useChat';
import { Shield, LogIn } from 'lucide-react';
import { useSession, signIn, SessionProvider } from 'next-auth/react';

function AppContent() {
  const { data: session, status } = useSession();
  const { campaigns, loading: campaignsLoading } = useCampaigns();
  const { messages, viewConfig, setViewConfig, isLoading: chatLoading, sendMessage } = useChat(campaigns);
  const { items, loading: itemsLoading, submitDecision } = useReviewItems(viewConfig.campaignId || null);

  const handleSelectCampaign = (campaignId: string) => {
    setViewConfig({
      layout: 'flat-table',
      title: campaigns.find(c => c.id === campaignId)?.template?.name || 'Review Items',
      campaignId,
    });
  };

  const handleDecide = async (
    campaignId: string,
    reviewItemId: string,
    decision: 'APPROVE' | 'REVOKE',
    reviewerLevelId: string,
    note: string
  ) => {
    try {
      await submitDecision(campaignId, reviewItemId, decision, reviewerLevelId, note);
    } catch (error: any) {
      console.error('Decision failed:', error);
    }
  };

  // Loading state
  if (status === 'loading' || campaignsLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-center space-y-4">
          <Shield className="w-12 h-12 mx-auto text-blue-400 animate-pulse" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-center space-y-6 max-w-md">
          <Shield className="w-16 h-16 mx-auto text-blue-400" />
          <h1 className="text-2xl font-bold text-gray-100">Access Certification Review</h1>
          <p className="text-gray-400">
            AI-assisted access certification for Okta Identity Governance.
            Sign in with your Okta account to review and manage access certifications.
          </p>
          <button
            onClick={() => signIn('okta')}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg px-6 py-3 transition-colors"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Okta
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Chat Panel — left side */}
      <div className="w-80 shrink-0">
        <ChatPanel
          messages={messages}
          isLoading={chatLoading}
          onSend={sendMessage}
        />
      </div>

      {/* View Panel — right side */}
      <div className="flex-1 min-w-0">
        <ViewContainer
          viewConfig={viewConfig}
          campaigns={campaigns}
          items={items}
          itemsLoading={itemsLoading}
          onSelectCampaign={handleSelectCampaign}
          onDecide={handleDecide}
        />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  );
}
