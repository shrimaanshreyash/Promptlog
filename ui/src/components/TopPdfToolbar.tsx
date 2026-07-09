import React, { useState, useEffect } from 'react';
import { ActionButton } from './ActionButton';
import { StatusPill } from './StatusPill';

interface TopPdfToolbarProps {
  projectName: string;
  sseStatus: 'active' | 'inactive' | 'error';
  onTriggerExport: () => void;
  onScanComplete?: () => void;
}

export const TopPdfToolbar: React.FC<TopPdfToolbarProps> = ({
  projectName,
  sseStatus,
  onTriggerExport,
  onScanComplete,
}) => {
  const [scanning, setScanning] = useState(false);
  const [watching, setWatching] = useState(false);
  const [watcherLoading, setWatcherLoading] = useState(false);

  // Fetch initial watcher status
  useEffect(() => {
    const fetchWatcherStatus = async () => {
      try {
        const response = await fetch('/api/watcher/status');
        const data = await response.json();
        setWatching(!!data.watching);
      } catch (e) {
        console.error('Failed to get watcher status:', e);
      }
    };
    fetchWatcherStatus();
  }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      const response = await fetch('/api/scan', { method: 'POST' });
      if (response.ok) {
        if (onScanComplete) onScanComplete();
      } else {
        window.alert('SCAN ERROR: FAILED TO RESCAN CODEBASE');
      }
    } catch (e) {
      console.error(e);
      window.alert('SCAN ERROR: CONNECTION REFUSED');
    } finally {
      setScanning(false);
    }
  };

  const handleToggleWatch = async () => {
    setWatcherLoading(true);
    try {
      const response = await fetch('/api/watcher/toggle', { method: 'POST' });
      const data = await response.json();
      if (response.ok && data.success) {
        setWatching(data.watching);
      } else {
        window.alert('WATCHER ERROR: FAILED TO TOGGLE');
      }
    } catch (e) {
      console.error(e);
      window.alert('WATCHER ERROR: CONNECTION REFUSED');
    } finally {
      setWatcherLoading(false);
    }
  };

  return (
    <header className="top-pdf-toolbar">
      <div className="toolbar-brand">
        <div className="logo mono">PromptLog</div>
        <div className="project-tag mono font-11">
          PROJECT: <span>{projectName || 'LOCAL FILESYSTEM'}</span>
        </div>
      </div>
      <div className="toolbar-actions">
        <ActionButton variant="lime" onClick={handleScan} disabled={scanning}>
          {scanning ? 'SCANNING...' : '🔍 RUN SCAN'}
        </ActionButton>
        <ActionButton
          variant={watching ? 'pink' : 'blue'}
          onClick={handleToggleWatch}
          disabled={watcherLoading}
        >
          {watcherLoading ? '...' : watching ? '⏹️ STOP WATCH' : '👁️ START WATCH'}
        </ActionButton>
        <ActionButton variant="peach" onClick={onTriggerExport}>
          💾 EXPORT DISK
        </ActionButton>
        
        <div className="divider" />
        
        <div className="status-group mono font-10">
          <div className="status-item">
            <span>LIVE:</span>
            <StatusPill status={sseStatus} label={sseStatus} />
          </div>
          <div className="status-item">
            <span>WATCH:</span>
            <StatusPill status={watching ? 'active' : 'inactive'} label={watching ? 'active' : 'inactive'} />
          </div>
        </div>
      </div>
    </header>
  );
};
