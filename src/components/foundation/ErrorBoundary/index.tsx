import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    console.error('React island error:', error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{ padding: '2rem', textAlign: 'center', border: '1px solid var(--wg-error)', borderRadius: '8px', margin: '1rem' }}>
          <h2 style={{ color: 'var(--wg-error)', marginTop: 0 }}>Something went wrong</h2>
          <p style={{ color: 'var(--wg-on-surface-variant)' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ padding: '0.5rem 1rem', cursor: 'pointer', borderRadius: '4px', border: '1px solid var(--wg-outline)', background: 'var(--wg-surface)' }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
