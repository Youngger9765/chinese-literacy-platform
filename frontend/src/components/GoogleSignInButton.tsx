/**
 * GoogleSignInButton
 *
 * Renders the official Google Sign-In button using the Google Identity Services
 * (GSI) script. The button is rendered by Google's library so that it complies
 * with Google's branding guidelines and works across all supported browsers.
 *
 * GOOGLE_CLIENT_ID must be set as VITE_GOOGLE_CLIENT_ID in the environment.
 * If the variable is missing the button is not rendered (feature flag behaviour).
 */
import React, { useEffect, useRef } from 'react';

interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void;
  /** Width in pixels (Google library accepts 200-400). Defaults to 400. */
  width?: number;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: string;
              size?: string;
              width?: number;
              text?: string;
              shape?: string;
              locale?: string;
            },
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onCredential,
  width = 400,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const initButton = () => {
      if (!window.google || !containerRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          if (response.credential) {
            onCredential(response.credential);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        width,
        text: 'signin_with',
        shape: 'rectangular',
        locale: 'zh-TW',
      });
    };

    // If script already loaded
    if (window.google) {
      initButton();
      return;
    }

    // Inject GSI script once
    if (!document.querySelector(`script[src="${GSI_SCRIPT_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = GSI_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = initButton;
      document.head.appendChild(script);
    } else {
      // Script tag exists but not yet loaded — wait for it
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', initButton);
      }
    }
  }, [onCredential, width]);

  if (!GOOGLE_CLIENT_ID) return null;

  return <div ref={containerRef} className="w-full flex justify-center" />;
};

export default GoogleSignInButton;
