import { Component } from "react";

/**
 * Catches render / chunk-load failures so the SPA does not white-screen.
 * Uses plain <a> so it works outside React Router too.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[FloGuard] ErrorBoundary", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="min-h-[50vh] grid place-items-center px-6 py-16 bg-background text-center"
          data-testid="error-boundary"
        >
          <div className="max-w-md">
            <p className="overline text-brand-orange mb-3">Something went wrong</p>
            <h1 className="font-display text-3xl text-brand-navy tracking-tight">
              We hit a snag loading this page.
            </h1>
            <p className="mt-4 text-brand-slate leading-relaxed">
              Try refreshing, or head home. If you need a drainage assessment now, call us.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                className="bg-brand-orange text-brand-ink font-semibold px-5 py-3 rounded-sm"
                onClick={() => {
                  this.setState({ error: null });
                  window.location.reload();
                }}
              >
                Reload page
              </button>
              <a
                href="/"
                className="border border-border text-brand-navy font-semibold px-5 py-3 rounded-sm inline-block"
              >
                Go home
              </a>
              <a href="tel:+13862590023" className="text-brand-orange font-semibold px-5 py-3">
                (386) 259-0023
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
