/**
 * TeacherLiveQuizSetup — step 1 of 3 ("選課文 → 開場 → 學生加入", PRD §1).
 *
 * §12: "設定頁預設只露班級、課文、題型、題數（預設 10）、秒數（預設 30），
 * 其餘收進「進階」" — shuffle / show_leaderboard_after_each / practice_mode
 * live behind an "進階設定" disclosure, not in the primary form.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { fetchStories, fetchStory } from '../../../services/api';
import type { Story } from '../../../types';
import { gradeLabel } from '../../../utils/gradeLabel';
import {
  listMyClassrooms,
  updateClassroomFeatureSettings,
  ClassroomApiError,
  type ClassroomResponse,
} from '../../../services/classroomApi';
import { createLiveQuizGame, LiveQuizApiError } from '../../../services/liveQuizApi';

const QUESTION_TYPES: { key: string; label: string }[] = [
  { key: 'comprehension', label: '閱讀理解' },
  { key: 'vocab_definitions', label: '詞語理解' },
  { key: 'vocab_application', label: '語詞應用' },
  { key: 'zhuyin', label: '注音挑戰' },
];

const SECONDS_OPTIONS = [20, 30, 45, 60];
const COUNT_OPTIONS: { key: 'all' | 10 | 15 | 20; label: string }[] = [
  { key: 10, label: '10 題' },
  { key: 15, label: '15 題' },
  { key: 20, label: '20 題' },
  { key: 'all', label: '全部' },
];
// issue #3631 P0 #1: "選項出現時間依題目長度...老師可選 慢／標準／快" —
// replaces the old raw-seconds input. The actual per-question seconds are
// computed server-side from each round's own stem length
// (reading_pace.compute_reading_seconds).
const READING_PACE_OPTIONS: { key: 'slow' | 'standard' | 'fast'; label: string }[] = [
  { key: 'slow', label: '慢' },
  { key: 'standard', label: '標準' },
  { key: 'fast', label: '快' },
];

interface Props {
  onCreated: (code: string, fallback: boolean) => void;
}

const TeacherLiveQuizSetup: React.FC<Props> = ({ onCreated }) => {
  const { token } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [gradeFilter, setGradeFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [classroomId, setClassroomId] = useState<number | ''>('');

  const [types, setTypes] = useState<Set<string>>(new Set(QUESTION_TYPES.map((t) => t.key)));
  const [seconds, setSeconds] = useState(30);
  const [countMode, setCountMode] = useState<'all' | 10 | 15 | 20>(10);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [readingPace, setReadingPace] = useState<'slow' | 'standard' | 'fast'>('standard');
  const [shuffle, setShuffle] = useState(false);
  const [showLeaderboardAfterEach, setShowLeaderboardAfterEach] = useState(true);
  const [practiceMode, setPracticeMode] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // issue #3607: 課堂搶答 is OFF by default per classroom when targeting
  // one — "不指定班級" (classroomId === '') is never gated, only a chosen
  // classroom can be disabled.
  const [enablingLiveQuiz, setEnablingLiveQuiz] = useState(false);
  const selectedClassroom = classroomId === '' ? null : classrooms.find((c) => c.id === classroomId) ?? null;

  useEffect(() => {
    fetchStories(token ?? undefined)
      .then((res) => {
        setStories(res.stories);
        setGrades(res.grades);
      })
      .catch(() => setError('課文清單載入失敗，請重新整理'));
    if (token) {
      listMyClassrooms(token)
        .then((res) => setClassrooms(res.items))
        .catch(() => {
          /* classroom list is optional (code/QR join still works) */
        });
    }
  }, [token]);

  const filteredStories = useMemo(
    () => (gradeFilter ? stories.filter((s) => s.grade === gradeFilter) : stories),
    [stories, gradeFilter],
  );

  const handleEnableLiveQuiz = async () => {
    if (!token || selectedClassroom == null || enablingLiveQuiz) return;
    setEnablingLiveQuiz(true);
    try {
      const result = await updateClassroomFeatureSettings(token, selectedClassroom.id, { live_quiz: true });
      setClassrooms((prev) =>
        prev.map((c) => (c.id === selectedClassroom.id ? { ...c, live_quiz: result.live_quiz } : c)),
      );
    } catch (err) {
      setError(err instanceof ClassroomApiError ? err.message : '開啟課堂搶答失敗，請稍後再試');
    } finally {
      setEnablingLiveQuiz(false);
    }
  };

  const toggleStory = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleType = (key: string) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSubmit = async () => {
    setError('');
    if (!token) {
      setError('請先登入');
      return;
    }
    if (selectedIds.size === 0) {
      setError('請至少選擇一篇課文');
      return;
    }
    if (types.size === 0) {
      setError('請至少選擇一種題型');
      return;
    }
    setSubmitting(true);
    try {
      // Only the (few) SELECTED lessons need their lesson_uid resolved —
      // the list endpoint doesn't carry it (shared with 圖書館/作業, kept
      // untouched), the detail endpoint does.
      const details = await Promise.all([...selectedIds].map((id) => fetchStory(id)));
      const lessonUids = details.map((d) => d.lessonUid).filter((u): u is string => !!u);
      if (lessonUids.length === 0) {
        setError('選取的課文沒有可用的課號，請改選其他課文');
        return;
      }
      const res = await createLiveQuizGame(token, {
        lesson_uids: lessonUids,
        source_modules: [...types],
        seconds,
        reading_pace: readingPace,
        question_count_mode: countMode,
        classroom_id: classroomId === '' ? null : classroomId,
        shuffle,
        show_leaderboard_after_each: showLeaderboardAfterEach,
        practice_mode: practiceMode,
      });
      onCreated(res.code, res.question_count_fallback);
    } catch (err) {
      setError(err instanceof LiveQuizApiError ? err.message : '建立失敗，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-on-surface mb-1">班級經營</h1>
      <p className="text-sm text-on-surface-variant mb-1">課堂搶答 · 現在全班一起玩，約 10 分鐘</p>
      <p className="text-sm text-on-surface-variant mb-6">選課文、設定題目，開場讓學生用手機加入</p>

      {error && (
        <div className="mb-4 rounded-lg bg-error/10 px-4 py-3 text-sm text-error" role="alert">
          {error}
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-on-surface">開給本班（選用）</h2>
        <select
          className="w-full rounded-lg border border-surface-dim bg-white px-3 py-2 text-sm"
          value={classroomId}
          onChange={(e) => setClassroomId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">不指定班級（只用代碼／QR 加入）</option>
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {/* issue #3607: 課堂搶答 OFF for the selected classroom — the page
            stays usable ("不指定班級" still works), but a clear one-click
            prompt shows instead of letting the teacher submit into a 403. */}
        {selectedClassroom && !selectedClassroom.live_quiz && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-accent-bg px-3 py-2 text-sm">
            <span className="text-accent">老師還沒為「{selectedClassroom.name}」開放課堂搶答</span>
            <button
              type="button"
              onClick={handleEnableLiveQuiz}
              disabled={enablingLiveQuiz}
              className="shrink-0 rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {enablingLiveQuiz ? '開啟中…' : '一鍵開啟'}
            </button>
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-on-surface">課文（可複選、可跨年級）</h2>
        <select
          className="mb-3 w-full rounded-lg border border-surface-dim bg-white px-3 py-2 text-sm"
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
        >
          <option value="">全部年級</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              {gradeLabel(g)}
            </option>
          ))}
        </select>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-surface-dim bg-white divide-y divide-surface-container-low">
          {filteredStories.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-container-low">
              <input
                type="checkbox"
                checked={selectedIds.has(s.id)}
                onChange={() => toggleStory(s.id)}
                className="h-4 w-4 accent-accent"
              />
              <span className="text-xs text-on-surface-variant w-14 shrink-0">{gradeLabel(s.grade ?? '')}</span>
              <span className="truncate">{s.title}</span>
            </label>
          ))}
          {filteredStories.length === 0 && <p className="px-3 py-4 text-sm text-on-surface-variant">載入中…</p>}
        </div>
        <p className="mt-1 text-xs text-on-surface-variant">已選 {selectedIds.size} 篇</p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-on-surface">題型</h2>
        <div className="flex flex-wrap gap-2">
          {QUESTION_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => toggleType(t.key)}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                types.has(t.key)
                  ? 'border-accent bg-accent-bg text-accent font-medium'
                  : 'border-surface-dim text-on-surface-variant'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-4">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-on-surface">題數</h2>
          <select
            className="w-full rounded-lg border border-surface-dim bg-white px-3 py-2 text-sm"
            value={String(countMode)}
            onChange={(e) => setCountMode((e.target.value === 'all' ? 'all' : Number(e.target.value)) as typeof countMode)}
          >
            {COUNT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-on-surface">每題秒數</h2>
          <select
            className="w-full rounded-lg border border-surface-dim bg-white px-3 py-2 text-sm"
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          >
            {SECONDS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} 秒
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mb-6">
        <button
          type="button"
          className="text-sm font-medium text-accent"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? '收起進階設定 ▲' : '進階設定 ▼'}
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-3 rounded-lg border border-surface-dim bg-surface-container-low p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-on-surface-variant">
                讀題速度（先只顯示題幹，選項延後出現；依題目長度自動調整秒數）
              </label>
              <div className="flex gap-2">
                {READING_PACE_OPTIONS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setReadingPace(p.key)}
                    className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                      readingPace === p.key
                        ? 'border-accent bg-accent-bg text-accent font-medium'
                        : 'border-surface-dim text-on-surface-variant'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} className="h-4 w-4 accent-accent" />
              題目隨機排序
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showLeaderboardAfterEach}
                onChange={(e) => setShowLeaderboardAfterEach(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              每題後顯示排行榜（僅投影端）
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={practiceMode}
                onChange={(e) => setPracticeMode(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              練習模式（不計分）
            </label>
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? '開場中…' : '開場'}
      </button>
    </div>
  );
};

export default TeacherLiveQuizSetup;
