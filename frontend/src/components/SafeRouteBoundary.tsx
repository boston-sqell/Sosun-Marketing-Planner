import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class SafeRouteBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Suspense Chunk Load Error:', error, errorInfo);

    // Auto-reload to fetch the new version index if a chunk fails to load
    const isChunkError =
      error.name === 'ChunkLoadError' ||
      /failed to fetch/i.test(error.message) ||
      /dynamically imported module/i.test(error.message);

    if (isChunkError) {
      window.location.reload();
    }
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{ padding: '3rem 2rem', textAlign: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', margin: '2rem auto', maxWidth: '500px' }}>
          <h3 style={{ marginBottom: '1rem', color: 'var(--red)' }}>Connection Interrupted</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '14px' }}>
            Failed to load this section of the application. The application may have been updated or your network connection is weak.
          </p>
          <button 
            onClick={() => window.location.reload()}
            style={{ 
              backgroundColor: 'var(--primary)', 
              color: '#fff', 
              border: 'none', 
              padding: '10px 20px', 
              borderRadius: '8px', 
              fontWeight: 600, 
              cursor: 'pointer',
              transition: 'var(--transition)'
            }}
          >
            Reload Planner
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
