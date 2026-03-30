/**
 * 知識補給站 — 三民學習單第九步
 * 顯示課文相關的 YouTube 影片和延伸資料
 */
import React, { useEffect } from 'react';
import type { Story } from '../../types';

interface KnowledgeStationProps {
  story: Story;
  onFinish: () => void;
  zhuyinActive?: boolean;
}

const KnowledgeStation: React.FC<KnowledgeStationProps> = ({ story, onFinish }) => {
  const storageKey = `knowledge_viewed_${story.id}`;

  // Mark as viewed on mount; clear on finish
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ viewed: true })); } catch {}
  }, [storageKey]);

  const handleFinish = () => {
    // Keep completion record — only clear on explicit redo
    onFinish();
  };

  const videoUrl = story.knowledgeVideoUrl;

  // Extract YouTube video ID from URL
  const getYouTubeEmbedUrl = (url: string): string | null => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : null;
  };

  const embedUrl = videoUrl ? getYouTubeEmbedUrl(videoUrl) : null;

  return (
    <div className="flex-1 flex flex-col bg-amber-50 overflow-hidden">
      {/* Header */}
      <div className="h-9 bg-white border-b border-gray-200 flex items-center px-4 gap-2 shrink-0">
        <span className="text-[10px] font-black text-accent-light uppercase tracking-widest">
          知識補給站
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-500">{story.title}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h2 className="text-xl font-black text-gray-900 mb-2">知識補給站</h2>
            <p className="text-sm text-gray-600">
              看看和這篇課文相關的影片，幫助你更深入了解主題
            </p>
          </div>

          {embedUrl ? (
            <div className="space-y-4">
              <div className="aspect-video rounded-2xl overflow-hidden bg-black shadow-lg">
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
                  className="inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M10 6V8H5V19H16V14H18V20C18 20.5523 17.5523 21 17 21H4C3.44772 21 3 20.5523 3 20V7C3 6.44772 3.44772 6 4 6H10ZM21 3V11H19V6.413L11.2071 14.2071L9.79289 12.7929L17.585 5H13V3H21Z" />
                  </svg>
                  在 YouTube 開啟
                </a>
              )}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
              <p className="text-gray-500 text-lg mb-2">這篇課文目前沒有知識補給站影片</p>
              <p className="text-gray-400 text-sm">未來會持續新增相關影片</p>
            </div>
          )}

          {/* Finish button */}
          <div className="flex justify-center pt-4">
            <button
              onClick={handleFinish}
              className="px-8 py-3 rounded-xl text-base font-bold bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95"
            >
              繼續前往報告
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeStation;
