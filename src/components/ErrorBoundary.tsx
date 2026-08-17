import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { APP_NAME } from '../config/constants';
import { logger } from '../lib/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * React Error Boundary — menangkap error rendering di komponen child
 * dan menampilkan fallback UI yang informatif alih-alih blank screen.
 *
 * Penggunaan:
 *   <ErrorBoundary>
 *     <YourComponent />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    logger.error('[ErrorBoundary] Caught error', error);
    logger.error('[ErrorBoundary] Component stack', errorInfo.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Jika ada custom fallback, gunakan itu
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-app-bg p-4">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-500/12 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>

            <h2 className="text-lg font-bold text-app-text mb-2">
              Terjadi Kesalahan
            </h2>

            <p className="text-sm text-app-muted mb-2">
              Maaf, terjadi kesalahan yang tidak terduga. Tim kami sudah mencatat error ini.
            </p>

            {import.meta.env.DEV && this.state.error && (
              <div className="mt-4 mb-4 p-3 rounded-xl bg-app-hover/80 text-left">
                <p className="text-[10px] font-mono text-red-500 mb-1 break-all">
                  {this.state.error.name}: {this.state.error.message}
                </p>
                {this.state.errorInfo && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-app-subtle cursor-pointer hover:text-app-text">
                      Component Stack
                    </summary>
                    <pre className="mt-1 text-[10px] text-app-subtle overflow-auto max-h-32 font-mono">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleReload}
                className={[
                  'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium',
                  'bg-primary-500 text-white hover:bg-primary-600',
                  'transition-colors duration-200',
                ].join(' ')}
              >
                <RefreshCw className="w-4 h-4" />
                Muat Ulang
              </button>
              <button
                onClick={() => window.location.href = '/dashboard'}
                className={[
                  'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium',
                  'border border-app-border text-app-text hover:bg-app-hover',
                  'transition-colors duration-200',
                ].join(' ')}
              >
                Ke Dashboard
              </button>
            </div>

            <p className="mt-6 text-[10px] text-app-subtle">
              {APP_NAME} — Jika masalah berlanjut, hubungi tim dukungan.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
