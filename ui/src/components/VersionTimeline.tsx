import React from 'react';
import { VersionCard } from './VersionCard';

interface VersionTimelineProps {
  versions: any[];
  onRollback: (versionNum: number) => void;
}

export const VersionTimeline: React.FC<VersionTimelineProps> = ({ versions, onRollback }) => {
  if (versions.length === 0) {
    return <div className="mono font-12 padding-10 text-center">NO CHRONOLOGICAL HISTORY FOUND.</div>;
  }

  return (
    <div className="version-timeline">
      {versions.map((v, index) => (
        <VersionCard
          key={v.id}
          version={v}
          onRollback={onRollback}
          isLatest={index === 0} // Index 0 is the latest version
        />
      ))}
    </div>
  );
};
