import React from 'react';
import { RetroWindow } from './RetroWindow';

interface EmptySystemStateProps {
  icon?: string;
  title?: string;
  message?: string;
  sub?: string;
}

export const EmptySystemState: React.FC<EmptySystemStateProps> = ({
  icon = '💾',
  title = 'AWAITING INPUT',
  message = 'SELECT PROMPT',
  sub = 'Choose a detected prompt from the archive on the left to inspect versions, diffs, and notes.',
}) => {
  return (
    <div className="empty-system-state">
      <RetroWindow title={title} headerBg="var(--cyan, #00bcd4)" className="error-window">
        <div className="error-body">
          <div className="error-icon">{icon}</div>
          <div className="error-message">{message}</div>
          <div className="error-sub">{sub}</div>
        </div>
      </RetroWindow>
    </div>
  );
};
