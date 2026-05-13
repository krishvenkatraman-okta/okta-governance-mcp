'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';

interface DecisionButtonsProps {
  reviewItemId: string;
  campaignId: string;
  reviewerLevelId: string;
  currentDecision: string;
  onDecide: (id: string, decision: 'APPROVE' | 'REVOKE', note: string) => void;
}

export default function DecisionButtons({
  reviewItemId,
  campaignId,
  reviewerLevelId,
  currentDecision,
  onDecide,
}: DecisionButtonsProps) {
  const [pendingDecision, setPendingDecision] = useState<'APPROVE' | 'REVOKE' | null>(null);
  const [note, setNote] = useState('');

  if (currentDecision === 'APPROVE') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
        <Check className="h-3 w-3" />
        Approved
      </span>
    );
  }

  if (currentDecision === 'REVOKE') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">
        <X className="h-3 w-3" />
        Revoked
      </span>
    );
  }

  if (pendingDecision) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Justification..."
          className="h-7 w-40 rounded border border-gray-700 bg-gray-800 px-2 text-xs text-gray-100 placeholder-gray-500 outline-none focus:border-gray-600"
          autoFocus
        />
        <button
          onClick={() => {
            onDecide(reviewItemId, pendingDecision, note);
            setPendingDecision(null);
            setNote('');
          }}
          className={cn(
            'h-7 rounded px-2.5 text-xs font-medium',
            pendingDecision === 'APPROVE'
              ? 'bg-green-600 text-white hover:bg-green-500'
              : 'bg-red-600 text-white hover:bg-red-500',
          )}
        >
          Submit
        </button>
        <button
          onClick={() => {
            setPendingDecision(null);
            setNote('');
          }}
          className="h-7 rounded px-2 text-xs text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setPendingDecision('APPROVE')}
        className="inline-flex h-7 items-center gap-1 rounded border border-green-500/30 bg-green-500/10 px-2.5 text-xs font-medium text-green-400 hover:bg-green-500/20"
      >
        <Check className="h-3 w-3" />
        Approve
      </button>
      <button
        onClick={() => setPendingDecision('REVOKE')}
        className="inline-flex h-7 items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2.5 text-xs font-medium text-red-400 hover:bg-red-500/20"
      >
        <X className="h-3 w-3" />
        Revoke
      </button>
    </div>
  );
}
