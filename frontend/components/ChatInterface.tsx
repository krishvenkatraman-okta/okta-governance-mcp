/**
 * ChatInterface Component
 *
 * Chat-based governance assistant UI with LiteLLM orchestration
 *
 * Features:
 * - Message history display
 * - Suggested prompts for common tasks
 * - Tool execution through chat
 * - User-friendly result rendering
 */

'use client';

import { useState } from 'react';
import { uiConfig } from '@/lib/ui-config';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatInterfaceProps {
  onClose?: () => void;
}

const SUGGESTED_PROMPTS = [
  "What governance-enabled apps can I manage?",
  "Generate activity report for ServiceNow",
  "Create review campaign for Salesforce",
  "Apply label high-risk to Salesforce",
];

export default function ChatInterface({ onClose }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: Message = { role: 'user', content };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Chat request failed');
      }

      const data = await response.json();

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message,
      };

      setMessages([...newMessages, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
      };
      setMessages([...newMessages, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleSuggestedPrompt = (prompt: string) => {
    sendMessage(prompt);
  };

  return (
    <div className="bg-white flex flex-col h-full">
      {/* Header */}
      <div
        className="p-6 border-b flex items-center justify-between"
        style={{ borderColor: uiConfig.colors.gray200 }}
      >
        <div>
          <h1 className="font-bold text-2xl" style={{ color: uiConfig.colors.gray900 }}>
            Okta Governance Assistant
          </h1>
          <p className="text-sm mt-1" style={{ color: uiConfig.colors.gray600 }}>
            Chat-powered governance operations with governed execution
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm mb-4" style={{ color: uiConfig.colors.gray600 }}>
              Ask me anything about your governance scope and applications
            </p>
            <div className="space-y-2">
              <p className="text-xs font-semibold" style={{ color: uiConfig.colors.gray900 }}>
                Suggested prompts:
              </p>
              {SUGGESTED_PROMPTS.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestedPrompt(prompt)}
                  disabled={loading}
                  className="block w-full text-left px-3 py-2 rounded text-sm transition-colors"
                  style={{
                    backgroundColor: uiConfig.colors.gray100,
                    color: uiConfig.colors.gray900,
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, idx) => (
          <div
            key={idx}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className="max-w-[80%] rounded-lg p-3"
              style={{
                backgroundColor:
                  message.role === 'user' ? uiConfig.colors.primary : uiConfig.colors.gray100,
                color: message.role === 'user' ? 'white' : uiConfig.colors.gray900,
              }}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div
              className="max-w-[80%] rounded-lg p-3"
              style={{
                backgroundColor: uiConfig.colors.gray100,
                color: uiConfig.colors.gray900,
              }}
            >
              <p className="text-sm">Thinking...</p>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div
        className="p-4 border-t"
        style={{ borderColor: uiConfig.colors.gray200 }}
      >
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="Ask about your governance scope..."
            className="flex-1 px-4 py-2 rounded-lg border"
            style={{
              borderColor: uiConfig.colors.gray300,
              color: uiConfig.colors.gray900,
            }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-6 py-2 rounded-lg font-semibold transition-colors"
            style={{
              backgroundColor:
                loading || !input.trim() ? uiConfig.colors.gray300 : uiConfig.colors.primary,
              color: 'white',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
