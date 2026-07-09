import React from 'react';

interface StatusPillProps {
  status: 'active' | 'inactive' | 'error' | 'loading';
  label: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ status, label }) => {
  return (
    <div className={`status-pill status-${status}`}>
      <span className="status-dot"></span>
      <span className="status-label">{label.toUpperCase()}</span>
    </div>
  );
};
