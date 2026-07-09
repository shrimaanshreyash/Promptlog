import React, { useState, useEffect } from 'react';

interface DiffViewerProps {
  promptId: string;
  versions: Array<{ id: string; version_number: number }>;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ promptId, versions }) => {
  const [fromVersion, setFromVersion] = useState<number | ''>('');
  const [toVersion, setToVersion] = useState<number | ''>('');
  const [diffData, setDiffData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Whenever selected prompt changes, clear version selection to force default load
    setFromVersion('');
    setToVersion('');
    setDiffData(null);
  }, [promptId]);

  const fetchDiff = async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/prompts/${promptId}/diff`;
      if (fromVersion !== '' && toVersion !== '') {
        url += `?from=v${fromVersion}&to=v${toVersion}`;
      }
      const response = await fetch(url);
      const data = await response.json();
      if (response.ok) {
        setDiffData(data);
        // Set dropdown state to match response if it was default
        if (fromVersion === '' && toVersion === '' && data.from && data.to) {
          setFromVersion(data.from.versionNumber);
          setToVersion(data.to.versionNumber);
        }
      } else {
        setError(data.error || 'Failed to fetch diff.');
      }
    } catch (e: any) {
      setError(e.message || 'Connection error.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiff();
  }, [promptId, fromVersion, toVersion]);

  // Create selectable options sorted by version number ascending
  const sortedVersions = [...versions].sort((a, b) => a.version_number - b.version_number);

  return (
    <div className="diff-viewer-panel">
      <div className="diff-controls-bar mono font-12">
        <div className="control-group">
          <label>BASE VERSION:</label>
          <select
            value={fromVersion}
            onChange={(e) => setFromVersion(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">(SELECT BASE)</option>
            {sortedVersions.map(v => (
              <option key={v.id} value={v.version_number}>v{v.version_number}</option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label>COMPARE TO:</label>
          <select
            value={toVersion}
            onChange={(e) => setToVersion(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">(SELECT COMPARE)</option>
            {sortedVersions.map(v => (
              <option key={v.id} value={v.version_number}>v{v.version_number}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div className="mono font-12 padding-10">COMPUTING FORENSIC DIFF...</div>}
      {error && <div className="error-box mono font-12 margin-10">{error}</div>}

      {!loading && !error && diffData && (
        <div className="diff-results-body">
          {diffData.message ? (
            <div className="empty-diff-msg mono font-12">{diffData.message}</div>
          ) : (
            <div className="diff-content-wrapper">
              <div className="diff-stats mono font-11">
                <span className="add-count">+{diffData.diff.stats.wordsAdded || 0} WORDS</span>
                <span className="remove-count">-{diffData.diff.stats.wordsRemoved || 0} WORDS</span>
              </div>
              <div className="word-diff-display mono">
                {diffData.diff.wordDiff.map((chunk: any, index: number) => {
                  if (chunk.added) {
                    return <span key={index} className="diff-added">{chunk.value}</span>;
                  }
                  if (chunk.removed) {
                    return <span key={index} className="diff-removed">{chunk.value}</span>;
                  }
                  return <span key={index} className="diff-unchanged">{chunk.value}</span>;
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
