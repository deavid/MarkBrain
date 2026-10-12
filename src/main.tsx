import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { DomainProvider } from './domains/DomainRegistry.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <DomainProvider>
    <App />
  </DomainProvider>
);
