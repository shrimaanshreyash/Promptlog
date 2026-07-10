import React, { useState, useEffect } from 'react';
import { ActionButton } from './ActionButton';
import { RetroWindow } from './RetroWindow';
import { errorMessage } from '../types';
import type { ApiResult } from '../types';

interface RollbackPanelProps {
  promptId: string;
  promptName: string;
  toVersion: number;
  onClose: () => void;
  onSuccess: () => void;
}

export const RollbackPanel: React.FC<RollbackPanelProps> = ({
  promptId,
  promptName,
  toVersion,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [patchPath, setPatchPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchPreview = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ promptId, toVersion }),
        });
        const data = await response.json() as ApiResult;
        if (response.ok && data.success && typeof data.content === 'string' && typeof data.patchPath === 'string') {
          setPreviewContent(data.content);
          setPatchPath(data.patchPath);
        } else {
          setError(data.error || 'Failed to generate rollback patch.');
        }
      } catch (e: unknown) {
        setError(errorMessage(e, 'Connection error while generating patch.'));
      } finally {
        setLoading(false);
      }
    };
    fetchPreview();
  }, [promptId, toVersion]);

  const handleApply = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/rollback/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptId, toVersion }),
      });
      const data = await response.json() as ApiResult;
      if (response.ok && data.success) {
        setSuccessMsg(data.message || `Rollback to v${toVersion} applied.`);
        // Automatically trigger scan on the backend to pick up the new version!
        await fetch('/api/scan', { method: 'POST' }).catch(err => console.error('Auto scan error:', err));
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 3000);
      } else {
        setError(data.error || 'Failed to apply rollback patch.');
      }
    } catch (e: unknown) {
      setError(errorMessage(e, 'Connection error while applying patch.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="popup-overlay">
      <RetroWindow title="ROLLBACK SYSTEM SAFEGUARD" headerBg="var(--peach)" className="rollback-panel-window" onClose={onClose}>
        <div className="rollback-panel-body">
          <div className="alert-banner">
            <span className="alert-icon">⚠️</span>
            <div className="alert-text">
              <strong className="mono">CAUTION: RESTORING PROMPT CONTENT</strong>
              <p className="font-11">This will replace only prompt "{promptName}" with version <strong>v{toVersion}</strong>.</p>
            </div>
          </div>

          {loading && <div className="panel-loading mono">PROCESSING SYSTEM TRANSACTION...</div>}

          {error && <div className="error-box mono font-12">{error}</div>}
          
          {successMsg && (
            <div className="success-box mono font-12">
              <p>🟢 {successMsg}</p>
              <p className="font-10 animate-blink">AUTO-SCANNING LOCAL CODEBASE IN 3 SECONDS...</p>
            </div>
          )}

          {!loading && !successMsg && previewContent && (
            <div className="patch-preview-container">
              <div className="patch-meta font-11 mono">
                <span>PATCH RECORD GENERATED:</span>
                <span className="patch-path">{patchPath}</span>
              </div>
              <pre className="patch-content mono font-12">{previewContent}</pre>
            </div>
          )}

          <div className="rollback-actions">
            <ActionButton variant="pink" onClick={onClose} disabled={loading}>ABORT OPERATION</ActionButton>
            <ActionButton variant="lime" onClick={handleApply} disabled={loading || !previewContent || !!successMsg}>
              CONFIRM ROLLBACK
            </ActionButton>
          </div>
        </div>
      </RetroWindow>
    </div>
  );
};
