/**
 * ListeningQuestionPanel — Phase 2 retell UI (Issue #1956)
 *
 * Renders the retelling input panel (text or voice mode) that was previously
 * embedded in the ListeningPractice monolith.
 */
import React from 'react';

interface ListeningQuestionPanelProps {
  retelling: string;
  setRetelling: (value: string) => void;
  retellMode: 'text' | 'voice';
  setRetellMode: (mode: 'text' | 'voice') => void;
  speechStatus: string;
  speechSupported: boolean;
  speechError: string | undefined;
  submitError: string | null;
  isEvaluating: boolean;
  onVoiceToggle: () => void;
  onSubmit: () => void;
  onStopListening: () => void;
}

const ListeningQuestionPanel: React.FC<ListeningQuestionPanelProps> = ({
  retelling,
  setRetelling,
  retellMode,
  setRetellMode,
  speechStatus,
  speechSupported,
  speechError,
  submitError,
  isEvaluating,
  onVoiceToggle,
  onSubmit,
  onStopListening,
}) => {
  return (
    <>
      {/* Header card */}
      <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-8 mt-4 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-accent text-2xl">record_voice_over</span>
          <h2 className="font-headline font-bold text-on-surface text-lg">用自己的話覆述</h2>
        </div>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          試著說出你剛才聽到的課文重點。不需要一字不差，用自己的話表達你記得的內容就可以。
        </p>
      </div>

      {/* Input mode toggle */}
      <div className="flex bg-surface-container-high rounded-full p-1.5 mb-6">
        <button
          onClick={() => {
            if (speechStatus === 'listening') onStopListening();
            setRetellMode('text');
          }}
          className={`flex-1 px-5 py-3 rounded-full text-sm font-headline font-bold transition-all ${
            retellMode === 'text'
              ? 'bg-surface-container-lowest text-accent shadow-sm'
              : 'text-on-surface-variant'
          }`}
        >
          鍵盤輸入
        </button>
        <button
          onClick={() => setRetellMode('voice')}
          disabled={!speechSupported}
          className={`flex-1 px-5 py-3 rounded-full text-sm font-headline font-bold transition-all ${
            retellMode === 'voice'
              ? 'bg-surface-container-lowest text-accent shadow-sm'
              : 'text-on-surface-variant'
          } ${!speechSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          語音輸入
        </button>
      </div>

      {/* Text input */}
      {retellMode === 'text' && (
        <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
          <textarea
            value={retelling}
            onChange={(e) => setRetelling(e.target.value)}
            placeholder="在這裡輸入你記得的課文內容..."
            rows={6}
            maxLength={2000}
            className="w-full px-4 py-3 border-2 border-surface-container-high rounded-2xl text-on-surface text-base placeholder-on-surface-variant/40 resize-none focus:outline-none focus:border-accent bg-transparent"
          />
          <p className="text-xs text-right text-on-surface-variant mt-2">{retelling.length} / 2000</p>
        </div>
      )}

      {/* Voice input */}
      {retellMode === 'voice' && (
        <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 flex flex-col items-center gap-4">
          <button
            onClick={onVoiceToggle}
            className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all ${
              speechStatus === 'listening'
                ? 'bg-tertiary hover:brightness-110 animate-pulse'
                : 'bg-accent hover:brightness-110'
            }`}
          >
            <span
              className="material-symbols-outlined text-white text-3xl"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {speechStatus === 'listening' ? 'stop' : 'mic'}
            </span>
          </button>
          <p className="text-sm text-on-surface-variant">
            {speechStatus === 'listening' ? '正在聆聽，點擊停止...' : '點擊麥克風開始說話'}
          </p>
          {retelling && (
            <div className="w-full bg-surface-container-low rounded-2xl p-4 mt-2">
              <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                已記錄
              </p>
              <p className="text-base text-on-surface leading-relaxed">{retelling}</p>
            </div>
          )}
          {speechError && <p className="text-sm text-tertiary">{speechError}</p>}
        </div>
      )}

      {/* Submit error */}
      {submitError && (
        <div className="mt-4 px-5 py-3 bg-tertiary-container/20 rounded-2xl">
          <span className="text-sm text-tertiary">{submitError}</span>
        </div>
      )}

      {/* Submit CTA — fixed bar is handled by parent orchestrator, this is the inline version */}
    </>
  );
};

export default ListeningQuestionPanel;
