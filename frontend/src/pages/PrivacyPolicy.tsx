import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface PolicySection {
  title: string;
  content: string;
}

interface PrivacyPolicyData {
  version: string;
  effective_date: string;
  platform_name: string;
  sections: Record<string, PolicySection>;
  last_updated: string;
}

const SECTION_ORDER = [
  'data_collection',
  'audio_data',
  'data_retention',
  'data_deletion',
  'children_privacy',
  'contact',
];

/** Renders newline characters in policy content as paragraph breaks. */
const PolicyContent: React.FC<{ text: string }> = ({ text }) => {
  const paragraphs = text.split('\n\n');
  return (
    <div className="space-y-3">
      {paragraphs.map((para, i) => {
        const lines = para.split('\n');
        return (
          <p key={i} className="text-gray-700 leading-relaxed text-sm whitespace-pre-line">
            {lines.join('\n')}
          </p>
        );
      })}
    </div>
  );
};

const PrivacyPolicy: React.FC = () => {
  const navigate = useNavigate();
  const [policy, setPolicy] = useState<PrivacyPolicyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_URL ?? '';
    fetch(`${apiBase}/api/privacy/policy`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<PrivacyPolicyData>;
      })
      .then((data) => {
        setPolicy(data);
        setLoading(false);
      })
      .catch(() => {
        setError('無法載入隱私政策，請稍後再試。');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500">載入隱私政策中...</span>
        </div>
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50 p-6">
        <div className="bg-white rounded-xl shadow p-8 max-w-md text-center">
          <p className="text-red-500 mb-4">{error ?? '發生未知錯誤'}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-amber-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate(-1)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="返回"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-gray-900">隱私政策</h1>
          </div>
          <p className="text-sm text-gray-500">
            平台：{policy.platform_name}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            版本 {policy.version}．生效日期：{policy.effective_date}
          </p>

          {/* Audio data highlight box */}
          <div className="mt-5 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-blue-500 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z"
                />
              </svg>
              <div>
                <p className="text-sm font-semibold text-blue-800 mb-1">關於錄音資料</p>
                <p className="text-sm text-blue-700">
                  本平台使用瀏覽器 Web Speech API 進行語音辨識。
                  <strong>語音錄音原始檔案不會上傳至伺服器</strong>，僅有辨識後的文字結果會傳送至後端。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Policy sections */}
        <div className="space-y-4">
          {SECTION_ORDER.filter((key) => key in policy.sections).map((key) => {
            const section = policy.sections[key];
            return (
              <section
                key={key}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6"
              >
                <h2 className="text-base font-bold text-gray-900 mb-3">{section.title}</h2>
                <PolicyContent text={section.content} />
              </section>
            );
          })}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-gray-400 mt-8">
          最後更新：{policy.last_updated}．如有疑問請透過頁面內聯絡方式與我們聯繫。
        </p>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
