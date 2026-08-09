import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts — prod CSP (style-src 'self') blocks third-party origins,
// so these must ship in the bundle. Guarded by no-external-fonts.test.ts.
import '@fontsource/inter-tight/400.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/inter-tight/600.css';
import '@fontsource/inter-tight/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import App from './App';
import './index.css';
import './dev-auth';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
