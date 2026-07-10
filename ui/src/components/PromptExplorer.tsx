import React from 'react';
import type { Prompt } from '../types';

interface PromptExplorerProps {
  prompts: Prompt[];
  allPrompts: Prompt[];
  selectedPromptId: string | null;
  onSelectPrompt: (prompt: Prompt) => void;
  searchTerm: string;
  onSearchChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
}

const STATUS_ICONS: Record<string, string> = {
  active: '\u{1F4C4}',
  candidate: '\u{1F50D}',
  removed_from_codebase: '\u{1F5D1}️',
  ignored: '\u{1F6AB}',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'CONFIRMED',
  candidate: 'NEEDS REVIEW',
  removed_from_codebase: 'DELETED FROM SOURCE',
  ignored: 'IGNORED',
};

export const PromptExplorer: React.FC<PromptExplorerProps> = ({
  prompts,
  allPrompts,
  selectedPromptId,
  onSelectPrompt,
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}) => {
  const counts = {
    active: allPrompts.filter(p => p.status === 'active').length,
    candidate: allPrompts.filter(p => p.status === 'candidate').length,
    removed: allPrompts.filter(p => p.status === 'removed_from_codebase').length,
    ignored: allPrompts.filter(p => p.status === 'ignored').length,
  };

  const displayCount = statusFilter === 'all'
    ? prompts.length
    : prompts.filter(p => p.status === statusFilter).length;

  return (
    <aside className="prompt-explorer">
      <div className="explorer-header mono">
        <span>ARCHIVE DATABASE</span>
        <span className="badge-count">{displayCount}</span>
      </div>

      <div className="explorer-controls">
        <input
          type="text"
          placeholder="SEARCH ARTIFACTS..."
          className="search-input mono font-11"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <div className="filter-tabs mono font-11">
          <button
            className={`filter-tab ${statusFilter === 'active' ? 'active' : ''}`}
            onClick={() => onStatusFilterChange('active')}
            title={`${counts.active} confirmed prompts`}
          >
            CONFIRMED ({counts.active})
          </button>
          <button
            className={`filter-tab ${statusFilter === 'candidate' ? 'active' : ''}`}
            onClick={() => onStatusFilterChange('candidate')}
            title={`${counts.candidate} need review`}
          >
            REVIEW ({counts.candidate})
          </button>
          <button
            className={`filter-tab ${statusFilter === 'removed_from_codebase' ? 'active' : ''}`}
            onClick={() => onStatusFilterChange('removed_from_codebase')}
          >
            REMOVED
          </button>
          <button
            className={`filter-tab ${statusFilter === 'ignored' ? 'active' : ''}`}
            onClick={() => onStatusFilterChange('ignored')}
          >
            IGNORED
          </button>
        </div>
      </div>

      <div className="explorer-list">
        {prompts.length === 0 ? (
          <div className="empty-explorer mono font-11 text-center padding-20">
            NO PROMPT SNAPSHOTS FOUND.
          </div>
        ) : (
          prompts.map((p) => {
            const isSelected = selectedPromptId === p.id;
            const isRemoved = p.status === 'removed_from_codebase';
            const isCandidate = p.status === 'candidate';
            return (
              <div
                key={p.id}
                onClick={() => onSelectPrompt(p)}
                className={`file-card ${isSelected ? 'is-active' : ''} ${isRemoved ? 'is-removed' : ''} ${isCandidate ? 'is-candidate' : ''}`}
              >
                <div className="file-header">
                  <span className="file-icon">{STATUS_ICONS[p.status] || '\u{1F4C4}'}</span>
                  <span className="file-name">{p.display_name}</span>
                </div>
                <div className="file-meta mono font-10">
                  <div className="file-stable-name">{p.stable_name}</div>
                  <div className={`file-status-label ${isCandidate ? 'status-candidate' : ''}`}>
                    {STATUS_LABELS[p.status] || p.status.toUpperCase()}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
