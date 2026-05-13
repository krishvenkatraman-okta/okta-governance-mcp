'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';

interface BulkActionsProps {
  selectedCount: number;
  onBulkDecide: (decision: 'APPROVE' | 'REVOKE', note: string) => void;
  onClear: () => void;
}

export default function BulkActions({ selectedCount, onBulkDecide, onClear }: BulkActionsProps) {
  const [showNote, setShowNote] = useState<'APPROVE' | 'REVOKE' | null>(null);
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    if (showNote) {
      onBulkDecide(showNote, note);
      setShowNote(null);
      setNote('');
    }
  };

  if (showNote) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">
          {showNote === 'APPROVE' ? 'Approve' : 'Revoke'} {selectedCount} items:
        </span>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Justification note..."
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 w-64"
          autoFocus
        />
        <button
          onClick={handleSubmit}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded px-3 py-1"
        >
          Submit
        </button>
        <button
          onClick={() => { setShowNote(null); setNote(''); }}
          className="text-gray-500 hover:text-gray-300 text-sm"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-400">{selectedCount} selected</span>
      <button
        onClick={() => setShowNote('APPROVE')}
        className="flex items-center gap-1 bg-green-600/20 hover:bg-green-600/30 text-green-400 text-sm rounded px-3 py-1.5 border border-green-600/30"
      >
        <Check className="w-3.5 h-3.5" /> Approve All
      </button>
      <button
        onClick={() => setShowNote('REVOKE')}
        className="flex items-center gap-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm rounded px-3 py-1.5 border border-red-600/30"
      >
        <X className="w-3.5 h-3.5" /> Revoke All
      </button>
      <button onClick={onClear} className="text-gray-500 hover:text-gray-300 text-xs ml-1">
        Clear
      </button>
    </div>
  );
}
