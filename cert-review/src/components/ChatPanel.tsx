'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import type { ChatMessage } from '@/lib/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSend: (message: string) => void;
}

export function ChatPanel({ messages, isLoading, onSend }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col h-full border-r border-gray-800 bg-gray-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-400" />
          <h2 className="text-sm font-semibold text-gray-200">Certification Assistant</h2>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Ask me to show reviews in different ways
        </p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-600 text-sm mt-8 space-y-3">
            <Bot className="w-10 h-10 mx-auto text-gray-700" />
            <p>Try saying:</p>
            <div className="space-y-2">
              {[
                'Show me my campaigns',
                'Show me high risk Salesforce reviews',
                'Group reviews by user',
                'Which items does the AI recommend revoking?',
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => onSend(suggestion)}
                  className="block w-full text-left px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-xs transition-colors"
                >
                  &ldquo;{suggestion}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <Bot className="w-5 h-5 text-blue-400 mt-1 shrink-0" />
            )}
            <div className={`rounded-lg px-3 py-2 max-w-[85%] text-sm ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-900 text-gray-200'
            }`}>
              {msg.content}
              {msg.view && (
                <div className="mt-1 text-xs text-gray-500">
                  View: {msg.view.layout} {msg.view.title ? `— ${msg.view.title}` : ''}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <User className="w-5 h-5 text-gray-500 mt-1 shrink-0" />
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2">
            <Bot className="w-5 h-5 text-blue-400 mt-1" />
            <div className="bg-gray-900 rounded-lg px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about your reviews..."
            disabled={isLoading}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg px-3 py-2 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
