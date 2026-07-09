import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RetroWindow } from './RetroWindow';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[PromptLog UI Error]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}>
          <RetroWindow title="SYSTEM FAULT" headerBg="#ff6b9d">
            <div style={{ padding: '20px', fontFamily: 'monospace' }}>
              <p style={{ fontSize: '14px', fontWeight: 700 }}>DASHBOARD ERROR</p>
              <p style={{ fontSize: '12px', color: '#666' }}>
                {this.state.error?.message || 'Unknown error'}
              </p>
              <button
                style={{
                  marginTop: '15px', padding: '8px 16px', cursor: 'pointer',
                  background: '#c8ff00', border: '2px solid #1a1a1a', fontWeight: 700,
                  fontFamily: 'monospace', fontSize: '11px',
                }}
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                RETRY
              </button>
            </div>
          </RetroWindow>
        </div>
      );
    }

    return this.props.children;
  }
}
