import React, { useState } from 'react';
import { formatLocalDateTime } from '../utils/time';
import { ActionButton } from './ActionButton';
import { DiffViewer } from './DiffViewer';
import { VersionTimeline } from './VersionTimeline';
import type { Prompt, PromptVersion } from '../types';

interface PromptDocumentViewerProps {
  prompt: Prompt;
  versions: PromptVersion[];
  onAddNote: () => void;
  onRollback: (versionNum: number) => void;
  onClassificationChange?: () => void;
}

export const PromptDocumentViewer: React.FC<PromptDocumentViewerProps> = ({
  prompt,
  versions,
  onAddNote,
  onRollback,
  onClassificationChange,
}) => {
  const isRemoved = prompt.status === 'removed_from_codebase';
  const isCandidate = prompt.status === 'candidate';
  const [actionPending, setActionPending] = useState(false);

  const handleAction = async (action: 'confirm' | 'ignore' | 'mark-code') => {
    setActionPending(true);
    try {
      await fetch(`/api/prompts/${prompt.id}/${action}`, { method: 'POST' });
      onClassificationChange?.();
    } catch (e) {
      console.error('Classification action failed:', e);
    }
    setActionPending(false);
  };

  const statusColor = isRemoved ? 'var(--pink)' : isCandidate ? '#ffd700' : 'var(--lime)';
  const statusLabel = isCandidate ? 'CANDIDATE — NEEDS REVIEW' : prompt.status.toUpperCase().replace(/_/g, ' ');

  return (
    <section className="document-canvas">
      <div className="document-page">
        <div className="doc-header">
          <div className="doc-title-area">
            <div className="doc-status-badge mono font-10" style={{
              backgroundColor: statusColor,
              color: isCandidate ? '#000' : undefined,
            }}>
              {statusLabel}
            </div>
            <h1>{prompt.display_name}</h1>
            <div className="doc-stable-id mono font-11">
              SYSTEM ID: <span>{prompt.stable_name}</span>
            </div>
          </div>
          <div className="doc-actions">
            {isCandidate && (
              <>
                <ActionButton variant="lime" onClick={() => handleAction('confirm')} disabled={actionPending}>
                  ✓ CONFIRM
                </ActionButton>
                <ActionButton variant="pink" onClick={() => handleAction('ignore')} disabled={actionPending}>
                  ✕ IGNORE
                </ActionButton>
                <ActionButton variant="lavender" onClick={() => handleAction('mark-code')} disabled={actionPending}>
                  ⌨ MARK AS CODE
                </ActionButton>
              </>
            )}
            <ActionButton variant="lavender" onClick={onAddNote}>
              📓 HUMAN NOTES
            </ActionButton>
          </div>
        </div>

        <div className="doc-section doc-metadata-sheet mono font-11">
          <h3 className="section-title">FORENSIC METADATA</h3>
          <div className="grid-2-col">
            <div>PROMPT CLASS: <strong>{prompt.prompt_type.toUpperCase()}</strong></div>
            <div>FIRST RECORDED: <strong>{formatLocalDateTime(prompt.first_seen_at)}</strong></div>
            <div>LAST DETECTED: <strong>{formatLocalDateTime(prompt.last_seen_at)}</strong></div>
            <div>TOTAL REVISIONS: <strong>{versions.length}</strong></div>
          </div>
        </div>

        <div className="doc-section">
          <h3 className="section-title mono font-12">CHANGELOG COMPARATIVE DIFF</h3>
          <DiffViewer promptId={prompt.id} versions={versions} />
        </div>

        <div className="doc-section">
          <h3 className="section-title mono font-12">CHRONOLOGICAL HISTORY</h3>
          <VersionTimeline versions={versions} onRollback={onRollback} />
        </div>
      </div>
    </section>
  );
};
