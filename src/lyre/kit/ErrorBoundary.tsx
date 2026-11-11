import React from "react";
import { Button } from "./Button";

interface ErrorBoundaryProps {
  /** What failed, in the user's words: a box's title or a screen's name. */
  where: string;
  /** w51-fix2: a screen offers Back to the screen before (the shell's Back), as well as drawing it again. */
  onBack?: () => void;
  /** w51-fix2: when this changes (the page address), a message shown for the last one goes and the children draw again. */
  resetKey?: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * BUG-9: a fault in one box or screen shows a plain message there instead of a blank page mid-game. Everything
 * else (and any sound playing, which lives outside the screens) keeps working. "Show … again" draws it afresh; a
 * screen also offers Back (w51-fix2).
 *
 * w51-fix2: after a fault it draws its children once more by itself before showing the message. A fault in a part
 * that is going away (a screen's clean-up as it is left, Nik's crash on the way from Live to an Audio profile) is then
 * gone, and what replaced it shows; a part that fails again shows the message. The shell puts one round the window,
 * one round the screen (staying while screens change, so a screen failing as it is left is caught) and one round the
 * Now playing bar, so no fault leaves a blank page.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };
  /** Drawn once more since the last fault; cleared by a new resetKey and by Show … again. */
  private retried = false;

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Kept in the log for a bug report; the user sees the message below.
    console.error(`Lyre stopped showing ${this.props.where}:`, error);
  }

  componentDidMount() {
    this.retryOnce();
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey) {
      this.retried = false;
      if (this.state.failed) {
        this.setState({ failed: false });
        return;
      }
    }
    this.retryOnce();
  }

  /** The first fault since a reset: draw the children again; a part that fails again then shows the message. */
  private retryOnce() {
    if (!this.state.failed || this.retried) return;
    this.retried = true;
    this.setState({ failed: false });
  }

  private showAgain = () => {
    this.retried = false;
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    const { where, onBack } = this.props;
    return (
      <div className="kit-error" role="alert">
        <p>Something went wrong in {where}, so Lyre stopped showing it. Everything else keeps working.</p>
        <div className="row-flex">
          {onBack && <Button onClick={onBack}>Back</Button>}
          <Button onClick={this.showAgain}>Show {where} again</Button>
        </div>
      </div>
    );
  }
}
