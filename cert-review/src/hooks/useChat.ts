'use client';

import { useState, useCallback } from 'react';
import type { ChatMessage, ViewConfig, Campaign, AgentResponse } from '@/lib/types';
import { DEFAULT_VIEW } from '@/lib/view-schema';

export function useChat(campaigns: Campaign[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [viewConfig, setViewConfig] = useState<ViewConfig>(DEFAULT_VIEW);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: ChatMessage = { role: 'user', content, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          campaigns,
          history: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
            view: m.view,
          })),
        }),
      });

      const data: AgentResponse = await res.json();
      console.log('[useChat] Raw API response:', JSON.stringify(data).substring(0, 500));
      console.log('[useChat] Has view:', !!data.view);
      if (data.view) {
        console.log('[useChat] View config:', JSON.stringify(data.view));
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.message || 'I couldn\'t process that request.',
        view: data.view || undefined,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (data.view) {
        console.log('[useChat] Setting viewConfig to:', data.view.layout);
        setViewConfig(data.view);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [campaigns, messages]);

  return { messages, viewConfig, setViewConfig, isLoading, sendMessage };
}
