import React from "react";
import { Button } from "./Button";

interface ErrorBoundaryProps {
  /** What failed, in the user's words: a box's title or a screen's name. */
  where: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * BUG-9: a fault in one box or screen shows a plain message there instead of a blank page mid-game. Everything
 * else (and any sound playing, which lives outside the screens) keeps working. "Show … again" draws it afresh.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Kept in the log for a bug report; the user sees the message below.
    console.error(`Lyre stopped showing ${this.props.where}:`, error);
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    const { where } = this.props;
    return (
      <div className="kit-error" role="alert">
        <p>Something went wrong in {where}, so Lyre stopped showing it. Everything else keeps working.</p>
        <Button onClick={() => this.setState({ failed: false })}>Show {where} again</Button>
      </div>
    );
  }
}
