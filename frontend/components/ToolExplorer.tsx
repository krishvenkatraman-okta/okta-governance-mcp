/**
 * ToolExplorer Component
 *
 * Displays all available governance tools with categorization, badges, and detailed information
 */

'use client';

import { useState, useEffect } from 'react';
import { uiConfig } from '@/lib/ui-config';

interface ToolMetadata {
  name: string;
  description: string;
  category: string;
  type: 'read' | 'write';
  implementationStatus: 'implemented' | 'stub' | 'partial';
  isAuthorized: boolean;
  authorizationNote?: string;
  requirements: {
    scopes?: string[];
    capabilities?: string[];
    roles?: string[];
    requiresTargetResource: boolean;
  };
  notes?: string;
  exampleUsage?: string;
}

interface ToolsByCategory {
  metadata: ToolMetadata[];
  discovery: ToolMetadata[];
  reporting: ToolMetadata[];
  governance: ToolMetadata[];
  management: ToolMetadata[];
}

interface ToolsData {
  tools: ToolMetadata[];
  toolsByCategory: ToolsByCategory;
  stats: {
    total: number;
    authorized: number;
    unauthorized: number;
    implemented: number;
    stub: number;
    read: number;
    write: number;
  };
}

export default function ToolExplorer({ onClose }: { onClose?: () => void }) {
  const [toolsData, setToolsData] = useState<ToolsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<ToolMetadata | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    loadTools();
  }, []);

  const loadTools = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/governance/tools');
      if (!response.ok) {
        throw new Error('Failed to load tools');
      }
      const data = await response.json();
      setToolsData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  };

  const getToolBadges = (tool: ToolMetadata) => {
    const badges: Array<{ label: string; color: string }> = [];

    // Type badge
    badges.push({
      label: tool.type.toUpperCase(),
      color: tool.type === 'read' ? uiConfig.colors.success : '#f97316',
    });

    // Implementation status
    if (tool.implementationStatus === 'implemented') {
      badges.push({ label: 'READY', color: uiConfig.colors.success });
    } else if (tool.implementationStatus === 'stub') {
      badges.push({ label: 'PREVIEW', color: '#f59e0b' });
    }

    // Authorization
    if (!tool.isAuthorized) {
      badges.push({ label: 'LOCKED', color: uiConfig.colors.gray500 });
    }

    return badges;
  };

  const getCategoryTools = () => {
    if (!toolsData) return [];
    if (selectedCategory === 'all') return toolsData.tools;
    return toolsData.toolsByCategory[selectedCategory as keyof ToolsByCategory] || [];
  };

  const categories = [
    { id: 'all', label: 'All Tools', icon: '📋' },
    { id: 'discovery', label: 'Discovery', icon: '🔍' },
    { id: 'reporting', label: 'Reporting', icon: '📊' },
    { id: 'governance', label: 'Governance', icon: '⚖️' },
    { id: 'management', label: 'Management', icon: '⚙️' },
    { id: 'metadata', label: 'Metadata', icon: '📖' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-lg" style={{ color: uiConfig.colors.gray600 }}>
            Loading tools...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg p-4 border" style={{
        backgroundColor: '#fef2f2',
        borderColor: '#fecaca',
        color: uiConfig.colors.error,
      }}>
        <p className="font-semibold">Error loading tools</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  const displayTools = getCategoryTools();

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="border-b p-4" style={{ borderColor: uiConfig.colors.gray200 }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold" style={{ color: uiConfig.colors.gray900 }}>
              Governance Tools Explorer
            </h2>
            {toolsData && (
              <p className="text-sm mt-1" style={{ color: uiConfig.colors.gray600 }}>
                {toolsData.stats.total} tools total • {toolsData.stats.authorized} authorized • {toolsData.stats.implemented} ready • {toolsData.stats.stub} preview
              </p>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1 rounded text-sm"
              style={{
                backgroundColor: uiConfig.colors.gray200,
                color: uiConfig.colors.gray900,
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="border-b flex overflow-x-auto" style={{ borderColor: uiConfig.colors.gray200 }}>
        {categories.map((category) => {
          const isSelected = selectedCategory === category.id;
          return (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
              style={{
                borderColor: isSelected ? uiConfig.colors.primary : 'transparent',
                color: isSelected ? uiConfig.colors.primary : uiConfig.colors.gray600,
                backgroundColor: isSelected ? '#eff6ff' : 'transparent',
              }}
            >
              {category.icon} {category.label}
            </button>
          );
        })}
      </div>

      {/* Tools Grid */}
      <div className="p-4 max-h-[600px] overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayTools.map((tool) => (
            <div
              key={tool.name}
              onClick={() => setSelectedTool(tool)}
              className="border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md"
              style={{
                borderColor: tool.isAuthorized ? uiConfig.colors.gray200 : uiConfig.colors.gray300,
                backgroundColor: tool.isAuthorized ? 'white' : uiConfig.colors.gray50,
                opacity: tool.isAuthorized ? 1 : 0.7,
              }}
            >
              {/* Tool Name */}
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-mono text-sm font-semibold" style={{ color: uiConfig.colors.gray900 }}>
                  {tool.name}
                </h3>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-2 mb-3">
                {getToolBadges(tool).map((badge, idx) => (
                  <span
                    key={idx}
                    className="text-xs font-bold px-2 py-1 rounded"
                    style={{
                      backgroundColor: badge.color + '20',
                      color: badge.color,
                    }}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>

              {/* Description */}
              <p className="text-sm mb-2" style={{ color: uiConfig.colors.gray700 }}>
                {tool.description}
              </p>

              {/* Example Usage */}
              {tool.exampleUsage && (
                <div className="text-xs italic" style={{ color: uiConfig.colors.gray500 }}>
                  "{tool.exampleUsage}"
                </div>
              )}

              {/* Authorization Note */}
              {!tool.isAuthorized && tool.authorizationNote && (
                <div className="mt-2 text-xs p-2 rounded" style={{
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                }}>
                  🔒 {tool.authorizationNote}
                </div>
              )}
            </div>
          ))}
        </div>

        {displayTools.length === 0 && (
          <div className="text-center py-12" style={{ color: uiConfig.colors.gray500 }}>
            No tools in this category
          </div>
        )}
      </div>

      {/* Tool Details Modal */}
      {selectedTool && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedTool(null)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="border-b p-4" style={{ borderColor: uiConfig.colors.gray200 }}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-mono text-lg font-bold" style={{ color: uiConfig.colors.gray900 }}>
                    {selectedTool.name}
                  </h3>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {getToolBadges(selectedTool).map((badge, idx) => (
                      <span
                        key={idx}
                        className="text-xs font-bold px-2 py-1 rounded"
                        style={{
                          backgroundColor: badge.color + '20',
                          color: badge.color,
                        }}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedTool(null)}
                  className="text-2xl leading-none"
                  style={{ color: uiConfig.colors.gray500 }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Description */}
              <div>
                <h4 className="text-sm font-semibold mb-1" style={{ color: uiConfig.colors.gray900 }}>
                  Description
                </h4>
                <p className="text-sm" style={{ color: uiConfig.colors.gray700 }}>
                  {selectedTool.description}
                </p>
              </div>

              {/* Example Usage */}
              {selectedTool.exampleUsage && (
                <div>
                  <h4 className="text-sm font-semibold mb-1" style={{ color: uiConfig.colors.gray900 }}>
                    Example Usage
                  </h4>
                  <div className="text-sm italic p-3 rounded" style={{
                    backgroundColor: uiConfig.colors.gray100,
                    color: uiConfig.colors.gray700,
                  }}>
                    "{selectedTool.exampleUsage}"
                  </div>
                </div>
              )}

              {/* Requirements */}
              <div>
                <h4 className="text-sm font-semibold mb-2" style={{ color: uiConfig.colors.gray900 }}>
                  Requirements
                </h4>
                <div className="space-y-2 text-sm" style={{ color: uiConfig.colors.gray700 }}>
                  {selectedTool.requirements.roles && selectedTool.requirements.roles.length > 0 && (
                    <div>
                      <span className="font-semibold">Required Roles:</span>{' '}
                      {selectedTool.requirements.roles.join(', ')}
                    </div>
                  )}
                  {selectedTool.requirements.requiresTargetResource && (
                    <div>
                      <span className="font-semibold">Target Resource:</span> Required (e.g., app ID)
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              {selectedTool.notes && (
                <div>
                  <h4 className="text-sm font-semibold mb-1" style={{ color: uiConfig.colors.gray900 }}>
                    Notes
                  </h4>
                  <p className="text-sm" style={{ color: uiConfig.colors.gray600 }}>
                    {selectedTool.notes}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
