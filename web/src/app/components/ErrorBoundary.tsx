import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from './ui/button';

type Props = {
  children: ReactNode;
  title?: string;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary', error, info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 max-w-lg">
          <h2 className="text-lg font-bold text-white mb-2">
            {this.props.title ?? 'Không tải được nội dung'}
          </h2>
          <p className="text-sm text-red-200/90 mb-4 font-mono break-all">
            {this.state.error.message}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-border"
              onClick={() => this.setState({ error: null })}
            >
              Thử lại
            </Button>
            <Button asChild variant="outline" className="border-border">
              <Link to="/">Về trang chủ</Link>
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
