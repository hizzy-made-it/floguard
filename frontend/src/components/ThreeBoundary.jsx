import React from "react";

// Catches WebGL/Three errors so a failed 3D canvas degrades to a static fallback
// instead of crashing the page.
export class ThreeBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error("3D scene error (check stack for details):", error);
  }
  render() {
    if (this.state.failed) return this.props.fallback || null;
    return this.props.children;
  }
}
