import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { buildJunyiLoginUrl } from './JunyiCallbackPage';
import { trackEvent } from '../utils/analytics';

export const junyiNavigation = {
  replace(url: string): void {
    window.location.replace(url);
  },
};

/** Public entry point used by Junyi Portal and other Junyi products. */
const JunyiStartPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(false);
  const started = useRef(false);
  const postLoginPath = searchParams.get('post_login_path') ?? '/';

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    try {
      trackEvent('auth', 'junyi_login_initiated');
      junyiNavigation.replace(buildJunyiLoginUrl(postLoginPath));
    } catch {
      setError(true);
    }
  }, [postLoginPath]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center space-y-4">
        {error ? (
          <>
            <p className="text-red-600 text-sm">無法啟動均一登入，請回到 LingoLeap 登入頁重試。</p>
            <a
              href="/login"
              className="block w-full h-11 leading-[2.75rem] bg-accent text-white rounded-lg font-bold text-sm"
            >
              返回登入頁
            </a>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <div className="w-10 h-10 border-4 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-gray-600 text-sm">正在前往均一登入...</p>
          </>
        )}
      </div>
    </div>
  );
};

export default JunyiStartPage;
