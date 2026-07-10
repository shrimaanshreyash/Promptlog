import React, { useState } from 'react';
import { RetroWindow } from './RetroWindow';
import { ActionButton } from './ActionButton';
import { formatLocalDateTime } from '../utils/time';
import type { PromptVersion } from '../types';

interface VersionCardProps {
  version: PromptVersion;
  onRollback: (versionNum: number) => void;
  isLatest: boolean;
}

export const VersionCard: React.FC<VersionCardProps> = ({
  version,
  onRollback,
  isLatest,
}) => {
  const [collapsed, setCollapsed] = useState(!isLatest);
  const [copied, setCopied] = useState(false);

  const gitDirty = version.git_dirty_state === 1;
  const displayAuthor = version.git_author
    ? version.git_author.replace(/^([^@\s]+)@[^@\s]+$/, '$1@...')
    : null;

  return (
    <div className={`version-card-wrapper ${collapsed ? 'is-collapsed' : 'is-expanded'}`}>
      <RetroWindow
        title={`VERSION v${version.version_number} ${isLatest ? '(LATEST/ACTIVE)' : ''}`}
        headerBg={isLatest ? 'var(--lime)' : 'var(--panel)'}
      >
        <div className="v-card-header-bar" onClick={() => setCollapsed(!collapsed)}>
          <div className="v-meta-summary mono font-11">
            <span>DATE: {formatLocalDateTime(version.created_at)}</span>
            <span>LINES: {version.start_line}-{version.end_line}</span>
          </div>
          <span className="collapse-arrow">{collapsed ? '▼' : '▲'}</span>
        </div>

        {!collapsed && (
          <div className="v-card-details mono">
            <div className="v-git-meta font-10">
              <div>SOURCE: <span className="text-highlight">{version.source_file}</span></div>
              {version.git_commit && (
                <>
                  <div>COMMIT: <span className="text-highlight">{version.git_commit.slice(0, 7)}</span> {gitDirty && <span className="badge-dirty">DIRTY STATE</span>}</div>
                  <div>BRANCH: <span className="text-highlight">{version.git_branch}</span></div>
                  {displayAuthor && <div>AUTHOR: <span className="text-highlight">{displayAuthor}</span></div>}
                </>
              )}
            </div>

            <div className="v-code-block font-12">
              <div className="v-code-header">
                <button
                  className="copy-btn mono font-10"
                  onClick={() => {
                    navigator.clipboard.writeText(version.raw_content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? '✓ COPIED' : '📋 COPY'}
                </button>
              </div>
              <pre>{version.raw_content}</pre>
            </div>

            <div className="v-card-actions">
              {!isLatest && (
                <ActionButton variant="peach" onClick={() => onRollback(version.version_number)}>
                  ROLLBACK TO THIS VERSION
                </ActionButton>
              )}
            </div>
          </div>
        )}
      </RetroWindow>
    </div>
  );
};
