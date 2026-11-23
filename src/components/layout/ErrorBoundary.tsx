import React from "react";
import { AlertTriangle, RefreshCw, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isChunkLoadError, reloadOnceForNewBuild } from "@/lib/chunkReload";

type Props = {
  children: React.ReactNode;
  /** "page" keeps the sidebar and shows the message in the content area; "app" fills the screen. */
  variant?: "page" | "app";
  /** A change (the route's path) clears the error, so the next page renders normally. */
  resetKey?: string;
};

type State = { error: Error | null; resetKey?: string };

/**
 * Catches a render error or a failed page chunk so the screen is never left
 * entirely blank: React unmounts the whole tree on an uncaught error.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    if (isChunkLoadError(error)) reloadOnceForNewBuild();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunk = isChunkLoadError(error);
    const app = this.props.variant === "app";

    return (
      <div
        className={
          app
            ? "flex min-h-screen items-center justify-center bg-background p-4"
            : "flex min-h-[50vh] items-center justify-center p-4"
        }
        role="alert"
      >
        <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0 space-y-2">
              <h2 className="text-base font-semibold">
                {chunk ? "A new version of GST Keeper is available" : "This page could not be shown"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {chunk
                  ? "The app was updated while this tab was open. Reload to load the new version. Nothing you saved is lost."
                  : "Something went wrong while showing this page. Reload to try again. If it happens again, send the message below to support."}
              </p>
              {!chunk && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {error.message || String(error)}
                </pre>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" onClick={() => window.location.reload()}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                  Reload
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.location.assign("/dashboard")}>
                  <LayoutDashboard className="mr-2 h-4 w-4" aria-hidden />
                  Go to Dashboard
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
