import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

// Service Worker: deja la app disponible sin conexión y se actualiza sola.
registerSW({ immediate: true });

// Pide al navegador que no borre los datos locales si el teléfono se queda sin espacio.
void navigator.storage?.persist?.().catch(() => false);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
