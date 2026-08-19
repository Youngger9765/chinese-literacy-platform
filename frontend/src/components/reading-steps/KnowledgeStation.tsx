/**
 * 知識補給站 — 三民學習單第九步
 *
 * 顯示課文相關的 YouTube 影片（可有多部）和延伸資料。
 *
 * #1683 fixes:
 *  - 多影片 render：catalog 有多個 video_links 時全部 iframe 出來，不再只放第一部
 *  - 移除「你還有 N 個關卡沒有完成」reminder（per Young 5/19）
 *  - CTA 改「繼續下一步」由 stepper nav 帶到下一個 step，不再硬寫「前往報告」
 *    （知識補給站不一定是最後一關，例如 G7-L30 step_sequence 把它排在第 3 step）
 */
import React, { useEffect } from 'react';
import type { Story } from '../../types';
import { scopedStepStorageKey, isToolboxMode } from '../../services/learningStorageScope';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';

interface KnowledgeStationProps {
  story: Story;
  onFinish: () => void;
}

interface VideoEntry {
  title: string;
  /** `null` = 連結還在紙本的 QR code 裡（一修沒有對應課，QR 尚未解碼）。 */
  url: string | null;
  source?: string;
  duration?: string;
}

function getYouTubeEmbedUrl(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : null;
}

const KnowledgeStation: React.FC<KnowledgeStationProps> = ({ story, onFinish }) => {
  const storageKey = scopedStepStorageKey('knowledge_viewed_', story.id);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ viewed: true })); } catch {}
  }, [storageKey]);

  // Build the video list: prefer story.videoLinks (full list); fall back to legacy
  // single knowledgeVideoUrl (Layer-1 lessons without a video_links field).
  const videos: VideoEntry[] = (() => {
    if (story.videoLinks && story.videoLinks.length > 0) {
      // ⚠️ 不要 `.filter(v => !!v.url)`。有 5 課的影片連結還在紙本的 QR code 裡
      // （一修沒有對應課，QR 尚未解碼），它們帶著片名、來源、長度但沒有 url。
      // 濾掉之後清單變空，畫面就說「這篇課文目前沒有知識補給站影片」——
      // 那是不實的：影片存在，我們只是還沒有連結。
      return story.videoLinks.map((v) => ({
        title: v.title || '影片',
        url: v.url ?? null,
        source: v.source,
        duration: v.duration,
      }));
    }
    if (story.knowledgeVideoUrl) {
      return [{ title: '影片', url: story.knowledgeVideoUrl }];
    }
    return [];
  })();

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-hidden">
      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-48">
        <div className="max-w-3xl mx-auto px-6 md:px-16 py-8 space-y-6 w-full">
          <div className="text-center">
            <h2 className="text-xl font-headline font-bold text-on-surface mb-2">知識補給站</h2>
            <p className="text-sm text-on-surface-variant">
              看看和這篇課文相關的影片，幫助你更深入了解主題
            </p>
          </div>

          {videos.length > 0 ? (
            <div className="space-y-8">
              {videos.map((video, idx) => {
                // 連結還在紙本 QR code 裡：把我們知道的（片名／來源／長度）
                // 誠實顯示出來，並說清楚連結在哪。
                // 「有兩支影片但連結在紙本上」跟「沒有影片」是兩件事。
                if (!video.url) {
                  return (
                    <div
                      key={`${idx}-noUrl`}
                      className="rounded-2xl border border-gray-200 bg-surface-container-lowest p-5"
                    >
                      <div className="flex items-start gap-3">
                        <span className="material-symbols-outlined text-gray-400 mt-0.5">
                          qr_code_2
                        </span>
                        <div className="flex-1">
                          <p className="font-bold text-on-surface leading-snug">{video.title}</p>
                          <p className="text-sm text-on-surface-variant mt-1">
                            {[video.source, video.duration].filter(Boolean).join('　')}
                          </p>
                          <p className="text-xs text-on-surface-variant mt-2">
                            影片連結印在紙本學習單的 QR code 上，用手機掃描就可以看
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
                const embedUrl = getYouTubeEmbedUrl(video.url);
                return (
                  <div key={`${idx}-${video.url}`} className="space-y-3">
                    {videos.length > 1 && (
                      <h3 className="text-sm font-headline font-bold text-on-surface-variant">
                        {video.title}
                      </h3>
                    )}
                    {embedUrl ? (
                      <div className="aspect-video rounded-3xl overflow-hidden bg-black shadow-editorial">
                        <iframe
                          src={embedUrl}
                          title={`${story.title} — ${video.title}`}
                          className="w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 text-center">
                        <p className="text-on-surface-variant text-sm">這部影片無法嵌入 — 請從下方連結開啟</p>
                      </div>
                    )}
                    <a
                      href={video.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-accent hover:brightness-110 transition-colors"
                    >
                      <span className="material-symbols-outlined text-lg">open_in_new</span>
                      在 YouTube 開啟
                    </a>
                  </div>
                );
              })}
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

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto">
          {isToolboxMode() ? (
            <ToolboxCompletionActions
              onRetry={() => {
                // Knowledge Station is content-only — "retry" just reloads
                // the page to re-render the video from a fresh viewer state.
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
              繼續下一步
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
