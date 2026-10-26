import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { DomainProvider } from './domains/DomainRegistry.tsx';
import { applyUiFontScale, loadUiFontScale } from './ui/uiFontScale.ts';
import './index.css';

// Restore the text-size preference before first paint so a scaled boot doesn't
// flash at the default size (App re-applies it on every change).
applyUiFontScale(loadUiFontScale());

createRoot(document.getElementById('root')!).render(
  <DomainProvider>
    <App />
  </DomainProvider>
);
