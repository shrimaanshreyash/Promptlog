import React from 'react';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'cream' | 'pink' | 'lime' | 'lavender' | 'blue' | 'peach' | 'ink' | 'panel';
  children: React.ReactNode;
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  variant = 'panel',
  children,
  className = '',
  ...props
}) => {
  return (
    <button
      className={`action-btn btn-${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
