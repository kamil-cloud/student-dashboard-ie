import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';
import './styles/web.css';
import { IS_EXTENSION } from './platform/env';

// Apply the last used theme before first paint to avoid a flash.
try {
  const cached = localStorage.getItem('sd-theme');
  if (cached === 'light' || cached === 'dark') document.documentElement.dataset.theme = cached;
} catch {
  /* storage unavailable */
}

// Website: work offline once loaded (the extension does not need this).
if (import.meta.env.PROD && !IS_EXTENSION && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
