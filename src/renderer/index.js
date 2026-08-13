import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('Flowr renderer error:', error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: '-apple-system, Segoe UI, system-ui, sans-serif', background: '#f6f7f9', color: '#1b1e24', padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>&#9888;</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: '#646a74', margin: '0 0 20px', maxWidth: 400 }}>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button onClick={() => window.location.reload()} style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: '#3268e6', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Reload Flowr</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
