import React from 'react';

interface RetroWindowProps {
  title: string;
  children: React.ReactNode;
  headerBg?: string;
  className?: string;
  onClose?: () => void;
}

export const RetroWindow: React.FC<RetroWindowProps> = ({
  title,
  children,
  headerBg = 'var(--panel)',
  className = '',
  onClose,
}) => {
  return (
    <div className={`retro-window ${className}`}>
      <div className="window-header" style={{ backgroundColor: headerBg }}>
        <span className="window-title">{title}</span>
        <div className="window-controls">
          <div className="w-dot"></div>
          <div className="w-dot"></div>
          {onClose ? (
            <button className="w-dot close-btn" onClick={onClose} title="Close">×</button>
          ) : (
            <div className="w-dot"></div>
          )}
        </div>
      </div>
      <div className="window-body">
        {children}
      </div>
    </div>
  );
};
