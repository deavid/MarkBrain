import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { DomainProvider } from './domains/DomainRegistry.tsx';
import { applyUiFontScale, loadUiFontScale } from './ui/uiFontScale.ts';
import './index.css';
import './fonts.css';

// PWA service worker — production builds only (see public/sw.js). In dev the
// HMR websocket and the SW's fetch handler fight over every request.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell is a bonus, never a hard failure */
    });
  });
}

// Restore the text-size preference before first paint so a scaled boot doesn't
// flash at the default size (App re-applies it on every change).
applyUiFontScale(loadUiFontScale());

createRoot(document.getElementById('root')!).render(
  <DomainProvider>
    <App />
  </DomainProvider>
);
