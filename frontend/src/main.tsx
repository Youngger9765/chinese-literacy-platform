import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Extend Window to support GA4 gtag and dataLayer.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

// Inject GA4 gtag.js script only if VITE_GA_MEASUREMENT_ID is configured.
// This ensures graceful degradation in dev/staging without a GA ID.
const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
if (GA_ID) {
  const gtagScript = document.createElement('script');
  gtagScript.async = true;
  gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(gtagScript);

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { anonymize_ip: true });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
