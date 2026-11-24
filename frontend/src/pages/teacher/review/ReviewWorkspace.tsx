/**
 * 學習批閱 ③：批閱一課（#4104）
 *
 * 上面是學生看到的同一份成績單（雷達圖、關卡卡片、點開看逐題與歷次作答），
 * 套上老師正在改的內容當預覽 —— 退回的關卡變紅、評語與紅筆分數直接出現在卡片上。
 * 每張卡片下面是批閱工具（退回重做／分數／評語），最下面固定一條送出列。
 * 只有一顆「送出給學生」（案主定調）：退回、評語、分數一次送出。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { fetchStory, storyForStep } from '../../../services/api';
import {
  fetchReviewDetail,
  saveReviewDraft,
  sendReview,
  type ReviewDetail,
} from '../../../services/lessonReviewApi';
import { ApiError } from '../../../services/apiConfig';
import type { Story } from '../../../types';
import { resolveActiveSteps } from '../../../config/stepConfig';
import StepReportCards from '../../../components/report/StepReportCards';
import { buildStepReportCards, type StepReportCard } from '../../../components/report/reportCardsModel';
import {
  EMPTY_STEP,
  initialDraft,
  invalidScores,
  parseScore,
  previewOf,
  sameDraft,
  summaryOf,
  toInput,
  type ReviewDraft,
  type StepDraft,
} from './reviewDraft';

function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return '你在這個班級是「檢視者」，可以看但不能批閱。';
  return e instanceof Error && e.message ? e.message : '儲存失敗，請再試一次';
}

const ScoreInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  label: string;
  big?: boolean;
  testId?: string;
}> = ({ value, onChange, label, big, testId }) => {
  const bad = parseScore(value) === undefined;
  return (
    <label className="inline-flex items-center gap-1.5 text-sm text-gray-600">
      <span className="whitespace-nowrap">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
        placeholder="—"
        aria-label={label}
        aria-invalid={bad || undefined}
        data-testid={testId}
        className={`${big ? 'w-20 h-11 text-2xl' : 'w-14 h-9 text-lg'} rounded-lg border-2 text-center font-hand font-bold text-[#d03a2f] focus:outline-hidden focus:ring-2 focus:ring-red-200 ${
          bad ? 'border-red-500 bg-red-50' : 'border-gray-200'
        }`}
      />
      <span className="text-xs text-gray-400">/100</span>
    </label>
  );
};

const CardTools: React.FC<{
  card: StepReportCard;
  draft: StepDraft;
  redone: boolean;
  onChange: (patch: Partial<StepDraft>) => void;
}> = ({ card, draft, redone, onChange }) => {
  const [commentOpen, setCommentOpen] = useState(draft.comment !== '');
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 space-y-2" data-testid="review-card-tools">
      {redone && (
        <p className="rounded-lg bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700" data-testid="redone-note">
          退回後學生已重做，看完可以再給分或再退回
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ returned: !draft.returned })}
          aria-pressed={draft.returned}
          data-testid="toggle-return"
          className={`inline-flex items-center gap-1 h-9 rounded-full px-3 text-sm font-bold border-2 transition-colors ${
            draft.returned
              ? 'bg-red-600 border-red-600 text-white'
              : 'bg-white border-red-200 text-red-700 hover:bg-red-50'
          }`}
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">replay</span>
          {draft.returned ? '已選退回' : '退回重做'}
        </button>
        <ScoreInput
          label="分數"
          value={draft.score}
          onChange={(score) => onChange({ score })}
          testId="step-score"
        />
      </div>
      {commentOpen ? (
        <textarea
          value={draft.comment}
          onChange={(e) => onChange({ comment: e.target.value.slice(0, 500) })}
          rows={2}
          placeholder={draft.returned ? `為什麼退回「${card.label}」？例：錯的題目再讀一次第三段` : `給「${card.label}」的評語`}
          aria-label={`${card.label}的評語`}
          data-testid="step-comment"
          className="w-full rounded-lg border-2 border-gray-200 px-2 py-1.5 font-sans text-base text-[#d03a2f] focus:outline-hidden focus:ring-2 focus:ring-red-200"
        />
      ) : (
        <button
          type="button"
          onClick={() => setCommentOpen(true)}
          className="text-sm font-medium text-[#4d6b7e] hover:underline"
          data-testid="open-comment"
        >
          ✎ 寫評語
        </button>
      )}
    </div>
  );
};

const ReviewWorkspace: React.FC<{
  classroomId: number;
  studentId: number;
  storySlug: string;
  onBackToClass: () => void;
  onBackToStudent: () => void;
}> = ({ classroomId, studentId, storySlug, onBackToClass, onBackToStudent }) => {
  const { user } = useAuth();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [draft, setDraft] = useState<ReviewDraft>({ total: '', steps: {} });
  const [saved, setSaved] = useState<ReviewDraft>({ total: '', steps: {} });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const apply = useCallback((d: ReviewDetail) => {
    setDetail(d);
    const init = initialDraft(d);
    setDraft(init);
    setSaved(init);
  }, []);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError('');
    fetchReviewDetail(classroomId, studentId, storySlug)
      .then(async (d) => {
        if (!alive) return;
        apply(d);
        try {
          const s = await fetchStory(storySlug);
          if (alive) setStory(s);
        } catch {
          // 課文載不到：卡片仍照 step_progress 顯示能顯示的
        }
      })
      .catch((e: Error) => alive && setError(e.message || '載入失敗'));
    return () => {
      alive = false;
    };
  }, [classroomId, studentId, storySlug, apply]);

  const cards = useMemo(
    () =>
      buildStepReportCards(
        resolveActiveSteps(story?.stepSequence),
        detail?.step_progress?.steps_completed,
        detail?.step_progress?.step_data,
        undefined,
        { vocabularyFor: (id) => storyForStep(story, id)?.vocabulary },
      ),
    [story, detail],
  );

  const setStep = (key: string, patch: Partial<StepDraft>) =>
    setDraft((d) => ({ ...d, steps: { ...d.steps, [key]: { ...(d.steps[key] ?? EMPTY_STEP), ...patch } } }));

  const preview = useMemo(() => previewOf(draft, user?.name ?? null), [draft, user?.name]);
  const sum = summaryOf(draft, cards.length);
  const bad = invalidScores(draft);
  const dirty = !sameDraft(draft, saved);
  const returnedLabels = cards.filter((c) => draft.steps[c.stepId]?.returned).map((c) => c.label);

  const save = async (kind: 'draft' | 'send') => {
    if (bad.length) return;
    setBusy(kind);
    setNotice(null);
    try {
      const fn = kind === 'send' ? sendReview : saveReviewDraft;
      apply(await fn(classroomId, studentId, storySlug, toInput(draft)));
      setNotice({ ok: true, text: kind === 'send' ? '已送出，學生現在看得到了。' : '草稿已儲存（學生還看不到）。' });
      setConfirming(false);
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const crumbs = (
    <nav aria-label="批閱路徑" className="text-sm">
      <button type="button" onClick={onBackToClass} className="text-[#4d6b7e] hover:underline font-medium">
        全班
      </button>
      <span className="mx-2 text-gray-300">/</span>
      <button type="button" onClick={onBackToStudent} className="text-[#4d6b7e] hover:underline font-medium">
        {detail?.student_name ?? '學生'}
      </button>
      <span className="mx-2 text-gray-300">/</span>
      <span className="font-bold text-gray-900">{detail?.story_title ?? storySlug}</span>
    </nav>
  );

  if (error) {
    return (
      <div className="p-5 space-y-3">
        {crumbs}
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!detail) return <p className="p-6 text-sm text-gray-500" role="status">載入成績單…</p>;

  return (
    <div className="relative" data-testid="review-workspace">
      <div className="p-5 space-y-4 pb-40">
        {crumbs}
        <div className="rounded-xl bg-[#7C9AAD]/10 px-4 py-3 text-sm text-gray-700 space-y-1">
          <p>
            這是 <strong>{detail.student_name}</strong> 看到的成績單。每一關下面可以
            <strong className="text-red-700">退回重做</strong>、打分數、寫評語；改完按最下面
            <strong>「送出給學生」</strong>。卡片上的紅字是學生會看到的樣子。
          </p>
          <p className="text-xs text-gray-500">
            {detail.review.sent_at ? `上次送出：${when(detail.review.sent_at)}` : '還沒送出過'}
            {detail.draft && '・有一份還沒送出的草稿'}
          </p>
        </div>

        <StepReportCards
          storyTitle={story?.title ?? detail.story_title ?? undefined}
          cards={cards}
          review={preview}
          renderCardTools={(c) => (
            <CardTools
              key={c.stepId}
              card={c}
              draft={draft.steps[c.stepId] ?? EMPTY_STEP}
              redone={!!detail.review.steps[c.stepId]?.redone}
              onChange={(patch) => setStep(c.stepId, patch)}
            />
          )}
        />
      </div>

      {/* 送出列：固定在底部 */}
      <div
        className="sticky bottom-0 z-20 border-t border-gray-200 bg-white/95 backdrop-blur-sm px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
        data-testid="review-submit-bar"
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="text-sm text-gray-600 flex-1 min-w-[12rem]" data-testid="review-summary">
            {sum.returned > 0 ? (
              <span className="font-bold text-red-700">退回 {sum.returned} 關</span>
            ) : (
              <span>沒有退回</span>
            )}
            ・評語 {sum.comments} 則・已打分 {sum.scored}/{sum.stepCount} 關
            {sum.average != null && <span className="text-gray-400">（各關平均 {sum.average}）</span>}
          </p>
          <ScoreInput label="總分" value={draft.total} onChange={(total) => setDraft((d) => ({ ...d, total }))} big testId="total-score" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => save('draft')}
              disabled={!!busy || !dirty || bad.length > 0}
              className="h-11 rounded-full border-2 border-gray-300 px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              {busy === 'draft' ? '儲存中…' : '儲存草稿'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!!busy || bad.length > 0}
              data-testid="send-review"
              className="h-11 rounded-full bg-red-600 px-5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40"
            >
              送出給學生
            </button>
          </div>
        </div>
        {(bad.length > 0 || notice || dirty) && (
          <p
            className={`mt-1.5 text-xs ${bad.length || notice?.ok === false ? 'text-red-600' : notice ? 'text-emerald-700' : 'text-amber-700'}`}
            role="status"
            data-testid="review-notice"
          >
            {bad.length > 0 ? '分數要是 0 到 100 的整數。' : notice?.text ?? '有還沒送出的修改。'}
          </p>
        )}
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setConfirming(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-confirm-title"
            data-testid="review-confirm"
            className="w-full max-w-md rounded-2xl bg-white p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="review-confirm-title" className="text-lg font-bold text-gray-900">
              送出給 {detail.student_name}？
            </h3>
            <ul className="space-y-1.5 text-sm text-gray-700">
              <li>
                {returnedLabels.length ? (
                  <>
                    <strong className="text-red-700">退回 {returnedLabels.length} 關：</strong>
                    {returnedLabels.join('、')}（學生那邊會變紅色，要重做）
                  </>
                ) : (
                  '沒有退回的關卡'
                )}
              </li>
              <li>評語 {sum.comments} 則・各關分數 {sum.scored} 關</li>
              <li>總分：{sum.total != null ? <strong className="font-hand text-xl text-[#d03a2f]">{sum.total}</strong> : '不打總分'}</li>
            </ul>
            <p className="text-xs text-gray-500">送出後學生馬上看得到；之後還可以再改、再送出。</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-10 rounded-full border-2 border-gray-300 px-4 text-sm font-bold text-gray-700"
              >
                再看看
              </button>
              <button
                type="button"
                onClick={() => save('send')}
                disabled={!!busy}
                data-testid="confirm-send"
                className="h-10 rounded-full bg-red-600 px-5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy === 'send' ? '送出中…' : '確定送出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewWorkspace;
