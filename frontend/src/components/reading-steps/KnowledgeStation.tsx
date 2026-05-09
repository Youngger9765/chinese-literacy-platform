/**
 * 知識補給站 — 三民學習單第九步
 * 顯示課文相關的 YouTube 影片和延伸資料
 * #1104: 加缺漏步驟提示卡片，讓學生看到哪些關卡還沒完成（但不強制）
 */
import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Story } from '../../types';
import { scopedStepStorageKey, isToolboxMode } from '../../services/learningStorageScope';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';

export interface MissingStep {
  id: string;
  label: string;
}

interface KnowledgeStationProps {
  story: Story;
  onFinish: () => void;
  /** Steps not yet completed — shown as a soft reminder above the CTA. #1104 */
  missingSteps?: MissingStep[];
}

const KnowledgeStation: React.FC<KnowledgeStationProps> = ({ story, onFinish, missingSteps }) => {
  const storageKey = scopedStepStorageKey('knowledge_viewed_', story.id);
  const navigate = useNavigate();
  const { storyId } = useParams<{ storyId: string }>();

  const hasMissingSteps = missingSteps && missingSteps.length > 0;

  const handleGoToStep = (stepId: string) => {
    navigate(`/learn/${storyId ?? story.id}/${stepId}`);
  };

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ viewed: true })); } catch {}
  }, [storageKey]);

  const videoUrl = story.knowledgeVideoUrl;

  const getYouTubeEmbedUrl = (url: string): string | null => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : null;
  };

  const embedUrl = videoUrl ? getYouTubeEmbedUrl(videoUrl) : null;

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
        </div>
      </div>

      {/* Fixed bottom CTA — with optional missing-step reminder (#1104) */}
      <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto space-y-3">
          {/* Soft reminder: steps not yet completed */}
          {hasMissingSteps && (
            <div className="bg-surface-container-lowest border border-surface-container-high rounded-2xl p-4 shadow-sm">
              <div className="flex items-start gap-2 mb-3">
                <span className="material-symbols-outlined text-base text-amber-500 mt-0.5 shrink-0">info</span>
                <p className="text-sm font-headline font-bold text-on-surface">
                  你還有 {missingSteps!.length} 個關卡沒有完成
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {missingSteps!.map((step) => (
                  <button
                    key={step.id}
                    onClick={() => handleGoToStep(step.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-headline font-bold hover:bg-accent/20 active:scale-[0.97] transition-all"
                  >
                    <span className="material-symbols-outlined text-sm">play_circle</span>
                    {step.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isToolboxMode() ? (
            <ToolboxCompletionActions
              onRetry={() => {
                // Knowledge Station is content-only — "retry" just reloads
                // the page to re-render the video from a fresh viewer state.
                // TODO(#1462 follow-up): replace `window.location.reload()`
                // with a soft React reset (e.g. bump a key on the iframe).
                // Hard reload is acceptable here because there's no in-flight
                // state to lose on this terminal step, but a soft reset would
                // avoid the full-page flash.
                try { localStorage.removeItem(storageKey); } catch {}
                window.location.reload();
              }}
              className="w-full"
            />
          ) : (
            <button
              onClick={onFinish}
              className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
            >
              繼續前往報告
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
          )}
        </div>
      </div>

      {/* Background decoration */}
      <div className="fixed top-0 right-0 -z-10 w-96 h-96 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-0 -z-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />
    </div>
  );
};

export default KnowledgeStation;
