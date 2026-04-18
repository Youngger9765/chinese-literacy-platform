// TtsSentenceDetailPanel.tsx — right drawer for TTS entry details (Issue #1120)
import React, { useEffect, useRef } from 'react';
import type { ProvenanceEntry } from './types';
import { TtsInlineAnnotation } from './TtsInlineAnnotation';
import { useTtsAudio } from './useTtsAudio';

interface Props {
  entry: ProvenanceEntry | null;
  token: string;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(1) + 's';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' KB';
}

const MetaRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div className="flex gap-2 py-0.5">
    <dt className="text-gray-400 shrink-0 w-24 text-xs">{label}</dt>
    <dd className={`text-gray-700 text-xs break-all ${mono ? 'font-mono' : ''}`}>{value}</dd>
  </div>
);

export const TtsSentenceDetailPanel: React.FC<Props> = ({ entry, token, onClose }) => {
  const { state, toggle, stop } = useTtsAudio();
  const panelRef = useRef<HTMLDivElement>(null);

  // Stop audio when entry changes or panel closes
  useEffect(() => {
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.audit_id]);

  // Animate in/out
  const isOpen = entry !== null;

  if (!isOpen) return null;

  const e = entry;
  const hasReplacements = e.replacements_applied.length > 0;
  const playBtnLabel = state === 'playing' ? '暫停' : state === 'loading' ? '載入中...' : '播放';

  return (
    <div
      ref={panelRef}
      className="flex flex-col h-full bg-white border-l border-gray-200 w-[420px] shrink-0 overflow-hidden"
      role="complementary"
      aria-label="句子詳情"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-gray-400">
            L{String(e.lesson_id).padStart(2, '0')} · p{e.paragraph_idx}/s{e.sentence_idx}
          </span>
          {hasReplacements && (
            <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
              {e.replacements_applied.length} 替換
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded cursor-pointer"
          aria-label="關閉（Esc）"
          title="關閉（Esc）"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* Big play button */}
        <button
          onClick={() => toggle(e.tts_input, token)}
          disabled={state === 'loading'}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            state === 'playing'
              ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
              : state === 'error'
              ? 'bg-red-50 text-red-400 border border-red-100'
              : state === 'loading'
              ? 'bg-gray-50 text-gray-400 border border-gray-200 cursor-wait'
              : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
          }`}
        >
          {state === 'loading' ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          ) : state === 'playing' ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {playBtnLabel} {state === 'error' ? '(失敗，重試)' : '(Space)'}
        </button>

        {/* Inline annotation */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">原句 → TTS 轉換</h3>
          <div className="bg-gray-50 rounded-lg p-3 text-sm leading-loose">
            <TtsInlineAnnotation
              raw={e.raw_text}
              replacements={e.replacements_applied}
              compact={false}
            />
          </div>
        </section>

        {/* tts_prompt_prefix (new field) */}
        {e.tts_prompt_prefix && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Prompt Prefix</h3>
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap break-words">
              {e.tts_prompt_prefix}
            </div>
          </section>
        )}

        {/* tts_contents_sent (new field) */}
        {e.tts_contents_sent && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">實際送出字串</h3>
            <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap break-words">
              {e.tts_contents_sent}
            </div>
          </section>
        )}

        {/* Replacements detail */}
        {hasReplacements && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">替換規則明細</h3>
            <div className="space-y-1.5">
              {e.replacements_applied.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 text-sm"
                >
                  <span className="text-gray-700 font-medium">{r.from}</span>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className="text-orange-700 font-medium">{r.to}</span>
                  <span className="ml-auto text-xs text-gray-400 font-mono">{r.rule}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Integrity */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Integrity</h3>
          <dl className="space-y-0.5 bg-gray-50 rounded-lg p-3">
            <MetaRow label="sha256" value={e.audio_sha256.slice(0, 16) + '…'} mono />
            <MetaRow label="bytes" value={formatBytes(e.audio_bytes)} />
            <MetaRow label="duration" value={formatDuration(e.audio_duration_ms)} />
            <MetaRow label="latency" value={e.generation_latency_ms + 'ms'} />
            <MetaRow label="attempt" value={String(e.attempt_number)} />
          </dl>
        </section>

        {/* Trace */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Trace</h3>
          <dl className="space-y-0.5 bg-gray-50 rounded-lg p-3">
            <MetaRow label="audit_id" value={e.audit_id.slice(0, 8) + '…'} mono />
            <MetaRow label="batch_run" value={e.batch_run_id.slice(0, 16) + '…'} mono />
            <MetaRow label="git_sha" value={e.script_git_sha.slice(0, 8)} mono />
            <MetaRow label="generated_by" value={e.generated_by} />
            <MetaRow label="env" value={e.environment} />
            <MetaRow label="provider" value={e.provider} />
            <MetaRow label="model" value={e.model} />
            <MetaRow label="voice" value={e.voice} />
          </dl>
        </section>

        {/* Generated at */}
        <p className="text-xs text-gray-400">
          生成時間：{new Date(e.generated_at).toLocaleString('zh-TW')}
        </p>

        {/* Supersedes */}
        {e.supersedes && (
          <div className="text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs">
            此 entry 取代了 audit_id:{' '}
            <span className="font-mono">{e.supersedes.slice(0, 8)}…</span>
            （{new Date(e.generated_at).toLocaleString('zh-TW')} 版）
          </div>
        )}
      </div>
    </div>
  );
};
