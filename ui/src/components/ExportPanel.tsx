import React, { useState } from 'react';
import { ActionButton } from './ActionButton';
import { RetroWindow } from './RetroWindow';
import { errorMessage } from '../types';
import type { ApiResult } from '../types';

interface ExportPanelProps {
  onClose: () => void;
}

export const ExportPanel: React.FC<ExportPanelProps> = ({ onClose }) => {
  const [format, setFormat] = useState<'md' | 'json' | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      const data = await response.json() as ApiResult;
      if (data.success) {
        setResult(`SUCCESS: EXPORTED TO .promptlog/exports/ IN ${format.toUpperCase()} FORMAT`);
      } else {
        setResult(`ERROR: ${data.error || 'FAILED TO EXPORT'}`);
      }
    } catch (e: unknown) {
      setResult(`ERROR: ${errorMessage(e, 'CONNECTION REFUSED')}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="popup-overlay">
      <RetroWindow title="EXPORT PROMPT DATABASE" headerBg="var(--blue)" className="export-panel-window" onClose={onClose}>
        <div className="export-panel-body">
          <p className="mono font-12">CHOOSE EXPORT FORMAT FOR COGNITIVE ARTIFACTS:</p>
          <div className="export-options">
            <label className="radio-container">
              <input
                type="radio"
                name="export-format"
                value="all"
                checked={format === 'all'}
                onChange={() => setFormat('all')}
              />
              <span className="radio-label">ALL (MARKDOWN + JSON)</span>
            </label>
            <label className="radio-container">
              <input
                type="radio"
                name="export-format"
                value="md"
                checked={format === 'md'}
                onChange={() => setFormat('md')}
              />
              <span className="radio-label">MARKDOWN CHANGELOGS</span>
            </label>
            <label className="radio-container">
              <input
                type="radio"
                name="export-format"
                value="json"
                checked={format === 'json'}
                onChange={() => setFormat('json')}
              />
              <span className="radio-label">RAW JSON SNAPSHOTS</span>
            </label>
          </div>

          {result && (
            <div className={`export-result-box ${result.startsWith('ERROR') ? 'result-error' : 'result-success'}`}>
              {result}
            </div>
          )}

          <div className="export-actions">
            <ActionButton variant="pink" onClick={onClose}>CANCEL</ActionButton>
            <ActionButton variant="lime" onClick={handleExport} disabled={loading}>
              {loading ? 'WRITING DISK...' : 'EXECUTE EXPORT'}
            </ActionButton>
          </div>
        </div>
      </RetroWindow>
    </div>
  );
};
