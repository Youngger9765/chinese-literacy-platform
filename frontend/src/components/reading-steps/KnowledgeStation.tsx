/**
 * 知識補給站 — 三民學習單第九步
 * 顯示課文相關的 YouTube 影片和延伸資料
 *
 * #1104: 未完成關卡時顯示缺漏清單 + 快速跳轉，不強制完成
 */
import React, { useEffect, useState } from 'react';
import type { Story } from '../../types';
import { scopedStepStorageKey } from '../../services/learningStorageScope';

interface MissingStep {
  id: string;
  label: string;
}

interface KnowledgeStationProps {
  story: Story;
  onFinish: () => void;
  /** Steps not yet completed — used to show reminder before navigating to report */
  missingSteps?: MissingStep[];
  /** Navigate to a specific step by its id (e.g. 'tutor', 'vocab') */
  onNavigateToStep?: (stepId: string) => void;
}

const KnowledgeStation: React.FC<KnowledgeStationProps> = ({
  story,
  onFinish,
  missingSteps = [],
  onNavigateToStep,
}) => {
  const storageKey = scopedStepStorageKey('knowledge_viewed_', story.id);
  const [showMissingHint, setShowMissingHint] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ viewed: true })); } catch {}
  }, [storageKey]);

  const videoUrl = story.knowledgeVideoUrl;

  const getYouTubeEmbedUrl = (url: string): string | null => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : null;
  };

  const embedUrl = videoUrl ? getYouTubeEmbedUrl(videoUrl) : null;

  const hasMissing = missingSteps.length > 0;

  const handleContinueToReport = () => {
    if (hasMissing) {
      setShowMissingHint(true);
    } else {
      onFinish();
    }
  };

  const handleForceToReport = () => {
    setShowMissingHint(false);
    onFinish();
  };

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-hidden">
      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-48 flex items-center">
        <div className="max-w-3xl mx-auto px-6 md:px-16 space-y-6 w-full">
          <div className="text-center">
            <h2 className="text-xl font-headline font-bold text-on-surface mb-2">知識補給站</h2>
            <p className="text-sm text-on-surface-variant">
              看看和這篇課文相關的影片，幫助你更深入了解主題
            </p>
          </div>

          {embedUrl ? (
            <div className="space-y-4">
              <div className="aspect-video rounded-3xl overflow-hidden bg-black shadow-editorial">
                <iframe
                  src={embedUrl}
                  title={`${story.title} — 知識補給站`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              {videoUrl && (
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-accent hover:brightness-110 transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">open_in_new</span>
                  在 YouTube 開啟
                </a>
              )}
            </div>
          ) : (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 text-center">
              <span className="material-symbols-outlined text-5xl text-on-surface-variant/30 mb-2">videocam_off</span>
              <p className="text-on-surface-variant text-lg mb-1">這篇課文目前沒有知識補給站影片</p>
              <p className="text-on-surface-variant/60 text-sm">未來會持續新增相關影片</p>
            </div>
          )}

          {/* Missing steps hint card — shown after user taps "繼續前往報告" with incomplete steps */}
          {showMissingHint && hasMissing && (
            <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6 space-y-4 shadow-editorial">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-2xl text-amber-500 mt-0.5 shrink-0">
                  pending_actions
                </span>
                <div>
                  <p className="font-headline font-bold text-amber-800 text-base">
                    還有 {missingSteps.length} 個關卡尚未完成
                  </p>
                  <p className="text-amber-700 text-sm mt-1">
                    完成所有關卡可以讓學習報告更完整！點擊下方關卡名稱直接跳過去
                  </p>
                </div>
              </div>

              {/* Quick-jump links */}
              <div className="flex flex-wrap gap-2">
                {missingSteps.map((step) => (
                  <button
                    key={step.id}
                    onClick={() => {
                      setShowMissingHint(false);
                      onNavigateToStep?.(step.id);
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white border border-amber-300 text-amber-800 text-sm font-bold hover:bg-amber-100 transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                    {step.label}
                  </button>
                ))}
              </div>

              {/* Still allow skipping to report */}
              <button
                onClick={handleForceToReport}
                className="text-xs text-amber-600 underline hover:text-amber-800 transition-colors"
              >
                沒關係，直接看報告
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto">
          <button
            onClick={handleContinueToReport}
            className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
          >
            繼續前往報告
            <span className="material-symbols-outlined text-xl">arrow_forward</span>
          </button>
        </div>
      </div>

      {/* Background decoration */}
      <div className="fixed top-0 right-0 -z-10 w-96 h-96 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-0 -z-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />
    </div>
  );
};

export default KnowledgeStation;
