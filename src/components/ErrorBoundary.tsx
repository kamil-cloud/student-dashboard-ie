import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/** Keeps a rendering bug on one page from taking down the whole app. Data is saved separately, so nothing is lost. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] page crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">
              <AlertTriangle size={26} />
            </div>
            <h3>Something went wrong on this page</h3>
            <p>Your data is safe — it’s saved separately. Try going back to the dashboard.</p>
            <p className="muted small mono">{this.state.error.message}</p>
            <div className="empty-action">
              <button
                className="btn btn-primary btn-md"
                onClick={() => {
                  this.setState({ error: null });
                  this.props.onReset?.();
                }}
              >
                Back to dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
