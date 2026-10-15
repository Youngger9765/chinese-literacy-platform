/**
 * BlockSequenceRenderer — spotlight v2 block-sequence UI (#2205).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import OrderingBlock, { OrderingBlockState } from './OrderingBlock';
import type {
  SpotlightBlock,
  SpotlightConceptBoxBlock,
  SpotlightExerciseBlock,
  SpotlightMatchingBlock,
  SpotlightV2,
  Story,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { validateStrategyAnswer } from '../../services/learningApi';
import type { StrategyGradeResult } from '../../services/learning/sentence';
import { FigureCard, buildImageSrc } from '../reading-steps/GraphicTextImageStrip';
import {
  blockStateKey,
  countVisibleSegments,
  figureLabelFromBlock,
  isBlockAnswered,
  isInteractiveBlock,
  isSectionHeaderPrompt,
  resolveFreeTextCorrect,
  resolveLessonCode,
  resolveSingleCorrect,
  segmentBlocks,
} from './spotlightBlockLogic';

interface Props {
  spotlight: SpotlightV2;
  story?: Story | null;
  lessonId?: string;
  onComplete?: () => void;
  onChange?: (state: Record<string, unknown>) => void;
  initialState?: Record<string, unknown>;
  onOpenKeypoints?: () => void;
}

const FALLBACK_GRADE: StrategyGradeResult = {
  is_correct: true,
  feedback: '已記錄你的答案，做得好！',
  suggestion: '',
};

/**
 * 選項有兩種形狀：陣列 `["甲","乙"]`，或以代號為 key 的物件 `{A:"甲", B:"乙"}`。
 *
 * ⚠️ 這不是「小心一點比較好」，是**整頁白屏**：對物件呼叫 `.map` 會丟
 * `options.map is not a function`，整個聚光燈步驟畫不出來。2026-08-17 拿真資料
 * 跑 renderer，L0003（single）與 L0007（multi）第一次就這樣掛掉——
 * 而型別檢查、lint、我手寫的 fixture 三個都看不到，因為它們用的都是陣列。
 *
 * 物件形狀的 key 順序照 YAML 原序，不重新排序：代號本身（A/B/C、1/2/3）就是
 * 教材印出來的順序，排序會讓答案索引對不上。
 */
/**
 * 題幹。抽取者寫過三個名字：`prompt`（規格）、`instruction`、`stem`。
 *
 * 契約門會擋掉沒有 `prompt` 的題目，但那是**落地前**的檢查；萬一有一筆溜過去，
 * 只讀 `prompt` 的後果是「選項在、題目整段不見」—— 學生看到四個選項不知道在問什麼，
 * 而且畫面不報錯。退化成「顯示得出來」比顯示空白安全得多。
 */
const promptOf = (block: unknown): string => {
  const b = (block ?? {}) as Record<string, unknown>;
  for (const k of ['prompt', 'instruction', 'stem']) {
    const v = b[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
};

const toOptionList = (options: unknown): string[] => {
  if (Array.isArray(options)) return options.map(o => String(o ?? ''));
  if (options && typeof options === 'object') {
    return Object.values(options as Record<string, unknown>).map(o => String(o ?? ''));
  }
  return [];
};

/**
 * The option map's own keys, or undefined for a plain array.
 *
 * Exam questions print (A)(B)(C)(D) and the worksheet's answer line names the
 * letter, so the key carries the option's identity while the text carries none of
 * it. Flattening with `toOptionList` alone drops the letter, leaving the answer
 * 'A' to be compared against a whole Chinese sentence — false either way. All 9
 * letter-keyed blocks in the library (L0020, L0044, L0070) were ungradeable.
 */
const toOptionKeys = (options: unknown): string[] | undefined => {
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    return Object.keys(options as Record<string, unknown>);
  }
  return undefined;
};

const BlockSequenceRenderer: React.FC<Props> = ({
  spotlight,
  story,
  lessonId,
  onComplete,
  onChange,
  initialState,
  onOpenKeypoints,
}) => {
  const { token } = useAuth();
  const storyTitle = story?.title;
  const passage = story?.content?.join('\n');
  const segments = useMemo(() => segmentBlocks(spotlight.blocks), [spotlight.blocks]);

  const [blockState, setBlockState] = useState<Record<string, unknown>>(
    () => (initialState?.blockState as Record<string, unknown>) ?? {},
  );
  const [feedback, setFeedback] = useState<Record<string, boolean | null>>(
    () => (initialState?.feedback as Record<string, boolean | null>) ?? {},
  );
  const [textGrades, setTextGrades] = useState<Record<string, StrategyGradeResult>>(
    () => (initialState?.textGrades as Record<string, StrategyGradeResult>) ?? {},
  );
  const [gradingKey, setGradingKey] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(() => !!(initialState?.allDone as boolean));

  const visibleSegmentCount = countVisibleSegments(segments, blockState);

  useEffect(() => {
    onChange?.({ blockState, feedback, textGrades, allDone, renderer: 'spotlight_v2' });
  }, [blockState, feedback, textGrades, allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const setBlockValue = useCallback((key: string, value: unknown) => {
    setBlockState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const checkCompletion = useCallback(
    (nextState: Record<string, unknown>) => {
      const allComplete = segments.every((seg, segIdx) => {
        const interactive = seg
          .map((b, i) => ({ b, i }))
          .filter(({ b }) => isInteractiveBlock(b.type));
        return interactive.every(({ b, i }) =>
          isBlockAnswered(b, nextState, blockStateKey(segIdx, i)),
        );
      });
      if (allComplete) {
        setAllDone(true);
        onComplete?.();
      }
    },
    [segments, onComplete],
  );

  const handleSingleSubmit = (segIdx: number, blockIdx: number, block: SpotlightBlock) => {
    if (block.type !== 'single') return;
    const key = blockStateKey(segIdx, blockIdx);
    const selected = blockState[key];
    if (typeof selected !== 'number') return;
    const options = toOptionList(block.options);
    const correct = resolveSingleCorrect(options, block.answer, selected, toOptionKeys(block.options));
    setFeedback((prev) => ({ ...prev, [key]: correct }));
    checkCompletion(blockState);
  };

  /**
   * 複選題。`multi` 的型別一直都在，switch 卻沒有分支，所以 68 個 block、37 課
   * 掉進 default —— 學生看得到題目、看不到任何選項，而且沒有任何錯誤訊息。
   *
   * ⚠️ 現行資料另有一個獨立缺陷：部分課的 `answer` 欄位等於整個 `options` 陣列
   * （抽取器把所有選項都寫成答案）。那種情況判分沒有意義，這裡一律當「已作答」
   * 收下，不謊報對錯 —— 資料修好之前，假裝判得出來比不判更糟。
   */
  const handleMultiSubmit = (segIdx: number, blockIdx: number, block: SpotlightBlock) => {
    if (block.type !== 'multi') return;
    const key = blockStateKey(segIdx, blockIdx);
    const selected = (blockState[key] as number[] | undefined) ?? [];
    if (selected.length === 0) return;
    // `SpotlightUnknownBlock` 的 index signature 讓 union 成員窄化後仍是 unknown
    // （既有問題，非本次引入），所以這裡明確取型別。
    const options = toOptionList(block.options);
    const answer = block.answer as unknown;
    const answerUnusable =
      answer == null || (Array.isArray(answer) && answer.length >= options.length);
    const correct = answerUnusable
      ? true
      : Array.isArray(answer) &&
        answer.length === selected.length &&
        [...selected].sort().join(',') ===
          [...(answer as number[])].map(Number).sort().join(',');
    setFeedback((prev) => ({ ...prev, [key]: correct }));
    checkCompletion(blockState);
  };

  const finishFreeText = (key: string, grade: StrategyGradeResult) => {
    setTextGrades((prev) => ({ ...prev, [key]: grade }));
    setFeedback((prev) => ({ ...prev, [key]: true }));
    checkCompletion(blockState);
  };

  const handleFreeTextSubmit = async (
    segIdx: number,
    blockIdx: number,
    block: SpotlightBlock,
  ) => {
    if (block.type !== 'free_text') return;
    const key = blockStateKey(segIdx, blockIdx);
    const text = String(blockState[key] ?? '').trim();
    if (!text) return;

    if (!token) {
      const localCorrect = resolveFreeTextCorrect(text, block.answer);
      finishFreeText(key, {
        ...FALLBACK_GRADE,
        is_correct: localCorrect,
        feedback: localCorrect ? '✓ 答對了' : '再想想看',
      });
      return;
    }

    setGradingKey(key);
    try {
      const grade = await validateStrategyAnswer(token, {
        question: promptOf(block) ?? '',
        studentAnswer: text,
        strategyName: spotlight.strategy_name,
        storyTitle,
        passage,
      });
      finishFreeText(key, grade);
    } catch {
      finishFreeText(key, FALLBACK_GRADE);
    } finally {
      setGradingKey(null);
    }
  };

  const renderGuide = (key: string, text: string) => (
    <div
      key={key}
      className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-5 py-4 text-base text-on-surface whitespace-pre-wrap leading-relaxed"
    >
      {text}
    </div>
  );

  /**
   * 巢狀子題的選項。#3559 / #3562：現場老師回報「聚光燈沒有選項可以點」
   * 「填答時沒有辦法作答」—— 真環境重現（lesson 20016 聚光燈 7/11「小試身手」）
   * 確認這裡以前永遠只畫純文字 `<div>`（只有一個 aria-hidden 的 ☐ 符號），
   * 完全沒有 onClick / button，學生怎麼點都沒有反應。
   *
   * 只在 `answer` 存在時才接上互動（match #2082 single/multi 題型的
   * 「點選→確認→對/錯」UX，不自己發明一套新樣式）；沒有 `answer` 的子題
   * （例如「◎推論小偵探」那種純填空提示）維持原本的純展示渲染，不在這次
   * 修復範圍內。
   *
   * 🔴 self-review 抓到：`answer` 不保證是單一值 —— 78 課 sub_block 裡有
   * 6 課（L0002/L0005/L0006/L0010/L0012/L0174）是複選，`answer` 是一個
   * 陣列（如 `[1, 3, 4]`）。直接把陣列丟給 `resolveSingleCorrect` 會在
   * `answer.trim()` 那行丟出 runtime TypeError，把這 6 課的聚光燈也弄壞 ——
   * 跟這次要修的 bug 是同一種「學生點不下去」，只是換一種死法。
   * 所以這裡先按 `Array.isArray(answer)` 分流成單選／複選兩條路徑，
   * 複選仿 `case 'multi'` 的 toggle + 排序後比對。
   */
  const renderSubBlockOptions = (
    key: string,
    opts: [string, string][],
    answer: unknown,
  ): React.ReactElement => {
    if (answer === undefined || answer === null) {
      return (
        <div className="space-y-1.5 mb-2">
          {opts.map(([ok, ov]) => (
            <div key={ok} className="rounded-lg border border-gray-200 px-3 py-2 text-base text-on-surface">
              <span aria-hidden className="mr-2 text-on-surface-variant">☐</span>
              {ok}. {ov}
            </div>
          ))}
        </div>
      );
    }

    const fb = feedback[key];

    if (Array.isArray(answer)) {
      const selected = (blockState[key] as number[] | undefined) ?? [];
      const toggle = (oi: number) =>
        setBlockValue(
          key,
          selected.includes(oi) ? selected.filter((x) => x !== oi) : [...selected, oi],
        );
      return (
        <div className="space-y-1.5 mb-2">
          {opts.map(([ok, ov], oi) => (
            <button
              key={ok}
              type="button"
              role="checkbox"
              aria-checked={selected.includes(oi)}
              disabled={fb !== undefined && fb !== null}
              onClick={() => toggle(oi)}
              className={[
                'w-full text-left rounded-lg border px-3 py-2 text-base transition-colors',
                selected.includes(oi)
                  ? 'border-violet-500 bg-violet-50 text-violet-900'
                  : 'border-gray-200 hover:border-violet-300',
              ].join(' ')}
            >
              <span aria-hidden className="mr-2 text-on-surface-variant">
                {selected.includes(oi) ? '☑' : '☐'}
              </span>
              {ok}. {ov}
            </button>
          ))}
          {fb === null || fb === undefined ? (
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => {
                // answer 的代號是 1-based（跟題本一致），selected 的 index 是 0-based。
                const answerIdx = (answer as (string | number)[]).map((a) => Number(a) - 1);
                const correct =
                  selected.length === answerIdx.length &&
                  [...selected].sort().join(',') === [...answerIdx].sort().join(',');
                setFeedback((prev) => ({ ...prev, [key]: correct }));
              }}
              className="mt-1 px-4 py-1.5 rounded-full text-base font-medium text-white bg-violet-600 disabled:opacity-40"
            >
              確認
            </button>
          ) : (
            <p className={`text-base font-medium ${fb ? 'text-green-700' : 'text-amber-700'}`}>
              {fb ? '✓ 答對了' : '再想想看'}
            </p>
          )}
        </div>
      );
    }

    const selected = blockState[key] as number | undefined;
    const optionKeys = opts.map(([ok]) => ok);
    return (
      <div className="space-y-1.5 mb-2">
        {opts.map(([ok, ov], oi) => (
          <button
            key={ok}
            type="button"
            disabled={fb !== undefined && fb !== null}
            onClick={() => setBlockValue(key, oi)}
            className={[
              'w-full text-left rounded-lg border px-3 py-2 text-base transition-colors',
              selected === oi
                ? 'border-violet-500 bg-violet-50 text-violet-900'
                : 'border-gray-200 hover:border-violet-300',
            ].join(' ')}
          >
            <span aria-hidden className="mr-2 text-on-surface-variant">
              {selected === oi ? '☑' : '☐'}
            </span>
            {ok}. {ov}
          </button>
        ))}
        {fb === null || fb === undefined ? (
          <button
            type="button"
            disabled={typeof selected !== 'number'}
            onClick={() => {
              if (typeof selected !== 'number') return;
              const correct = resolveSingleCorrect(
                opts.map(([, ov]) => ov),
                answer as string | number,
                selected,
                optionKeys,
              );
              setFeedback((prev) => ({ ...prev, [key]: correct }));
            }}
            className="mt-1 px-4 py-1.5 rounded-full text-base font-medium text-white bg-violet-600 disabled:opacity-40"
          >
            確認
          </button>
        ) : (
          <p className={`text-base font-medium ${fb ? 'text-green-700' : 'text-amber-700'}`}>
            {fb ? '✓ 答對了' : '再想想看'}
          </p>
        )}
      </div>
    );
  };

  /**
   * 巢狀小題遞迴渲染。深度用縮排與字級表示，不另外編號 ——
   * 教材上的「一、（一）1.」序號是 Word 自動編號，抽取結果裡本來就沒有。
   */
  const renderSubBlock = (
    sb: { label?: string; prompt?: string; stem?: string; intro?: string; instruction?: string;
          hint?: string; value?: string; options?: Record<string, string> | string[];
          answer?: unknown; blanks?: { answer: string }[]; items?: unknown[]; reflection?: string },
    key: string,
    depth: number,
  ): React.ReactElement => {
    const opts = Array.isArray(sb.options)
      ? sb.options.map((v, i) => [String(i + 1), v] as [string, string])
      : Object.entries(sb.options ?? {});
    return (
      <div key={key} className={depth > 0 ? 'mt-3 pl-4 border-l-2 border-gray-100' : ''}>
        {sb.label ? (
          <div className="text-base font-semibold text-violet-700 mb-1">{sb.label}</div>
        ) : null}
        {[sb.intro, sb.instruction, sb.prompt, sb.stem, sb.value]
          .filter((t): t is string => Boolean(t))
          .map((t, i) => (
            <p key={i} className="text-base text-on-surface mb-2 whitespace-pre-wrap leading-relaxed">{t}</p>
          ))}
        {sb.hint ? <p className="text-sm text-on-surface-variant mb-2">{sb.hint}</p> : null}
        {opts.length > 0 ? renderSubBlockOptions(key, opts, sb.answer) : null}
        {(sb.items ?? []).map((it, i) =>
          renderSubBlock(it as Parameters<typeof renderSubBlock>[0], `${key}-${i}`, depth + 1),
        )}
        {sb.reflection ? (
          <p className="mt-2 rounded-lg bg-amber-50 border-l-4 border-amber-400 px-3 py-2 text-base whitespace-pre-wrap">
            {sb.reflection}
          </p>
        ) : null}
      </div>
    );
  };

  const renderFigure = (block: SpotlightBlock) => {
    if (block.type !== 'figure') return null;
    // #2463: a figure referencing a table has no image and no inline table
    // data, so it can only draw an empty 「圖表參考」 placeholder. Tables live in
    // the 重點表 (keypoints) step — render nothing inline here.
    if (block.referent === 'table') return null;

    // 學習單裡有些「圖」其實是把教學步驟畫成圖（L0002 的三層階梯圖：先找主題 →
    // 再找小主題 → 補充細節）。那些字只存在於圖片像素裡，多模態抽取把它們轉錄下來，
    // 但沒有對應的圖檔資產可以配對。舊寫法在配不到圖時只畫一個佔位方塊，於是
    // **轉錄到的教學內容整段消失**，而且不報錯 —— 跟 multi 缺 case 同一種消失法。
    const steps = (block as { steps?: { label?: string; hint?: string }[] }).steps;
    if (Array.isArray(steps) && steps.length > 0) {
      return (
        <ol className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-sm font-semibold grid place-items-center">
                {i + 1}
              </span>
              <span className="text-base text-on-surface">
                {s.label ? <span className="font-medium">{s.label}</span> : null}
                {s.hint ? <span className="block text-sm text-on-surface-variant mt-0.5">{s.hint}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      );
    }

    const label = figureLabelFromBlock(block);
    const imgIdx = story?.images?.findIndex((i) => i.figure_label === label) ?? -1;
    const img = imgIdx >= 0 ? story?.images?.[imgIdx] : undefined;
    const lessonCode = resolveLessonCode(spotlight, story, lessonId, img?.filename);
    if (img && lessonCode) {
      return (
        <FigureCard
          src={buildImageSrc(img.filename, lessonCode)}
          alt={label ?? '圖'}
          caption={block.bind_paragraph ? String(block.bind_paragraph) : label ?? undefined}
          index={imgIdx}
          figureLabel={label ?? undefined}
        />
      );
    }
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-base text-on-surface-variant text-center">
        {label ? `${label}（圖片）` : '圖表參考'}
        {block.asset ? <span className="block text-xs mt-1 opacity-60">{block.asset}</span> : null}
      </div>
    );
  };

  const renderBlock = (block: SpotlightBlock, segIdx: number, blockIdx: number) => {
    const key = blockStateKey(segIdx, blockIdx);
    const fb = feedback[key];

    switch (block.type) {
      case 'guide':
        return renderGuide(key, block.text ?? '');

      case 'passage':
        return (
          <div key={key} className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
            <div className="text-sm font-semibold text-on-surface-variant mb-2">閱讀文本</div>
            {block.paragraphs.map((p, i) => (
              <p key={i} className="text-base text-on-surface mb-2 last:mb-0 leading-relaxed">
                {p}
              </p>
            ))}
            {/* 這段文章的出處（#3277）。原稿印著它，而這裡本來只畫 paragraphs。
                ⚠️ `SpotlightBlock` 是聯集型別，索引它的欄位會退化成 `unknown`
                （這支檔案既有的兩處型別錯就是同一個原因），所以這裡收斂成字串。 */}
            {typeof block.source_line === 'string' && block.source_line.trim() && (
              <p
                className="mt-3 text-sm text-on-surface-variant"
                data-testid="spotlight-passage-source-line"
              >
                {block.source_line}
              </p>
            )}
          </div>
        );

      case 'single': {
        const options = toOptionList(block.options);
        const selected = blockState[key];
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-base font-medium text-on-surface mb-3 whitespace-pre-wrap">{promptOf(block)}</p>
            <div className="space-y-2">
              {options.map((opt, oi) => (
                <button
                  key={oi}
                  type="button"
                  disabled={fb !== undefined && fb !== null}
                  onClick={() => setBlockValue(key, oi)}
                  className={[
                    'w-full text-left rounded-lg border px-4 py-2.5 text-base transition-colors',
                    selected === oi
                      ? 'border-violet-500 bg-violet-50 text-violet-900'
                      : 'border-gray-200 hover:border-violet-300',
                  ].join(' ')}
                >
                  {String.fromCharCode(65 + oi)}. {opt}
                </button>
              ))}
            </div>
            {fb === null || fb === undefined ? (
              <button
                type="button"
                onClick={() => handleSingleSubmit(segIdx, blockIdx, block)}
                disabled={typeof selected !== 'number'}
                className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600 disabled:opacity-40"
              >
                確認
              </button>
            ) : (
              <p className={`mt-3 text-base font-medium ${fb ? 'text-green-700' : 'text-amber-700'}`}>
                {fb ? '✓ 答對了' : '再想想看'}
              </p>
            )}
          </div>
        );
      }

      case 'free_text': {
        if (isSectionHeaderPrompt(promptOf(block))) {
          return renderGuide(key, promptOf(block));
        }
        const grade = textGrades[key];
        const isGrading = gradingKey === key;
        const isSubmitted = fb !== undefined && fb !== null;
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-base font-medium text-on-surface mb-3 whitespace-pre-wrap">{promptOf(block)}</p>
            <textarea
              value={String(blockState[key] ?? '')}
              disabled={isSubmitted || isGrading}
              onChange={(e) => setBlockValue(key, e.target.value)}
              rows={3}
              placeholder="請在此寫下你的答案…"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-base"
            />
            {!isSubmitted && !isGrading ? (
              <button
                type="button"
                onClick={() => void handleFreeTextSubmit(segIdx, blockIdx, block)}
                className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600"
              >
                送出
              </button>
            ) : null}
            {isGrading ? (
              <p className="mt-3 text-sm text-violet-600 font-semibold">AI 批改中…</p>
            ) : null}
            {!isGrading && grade ? (
              <div
                className={`mt-3 rounded-lg border p-3 ${
                  grade.is_correct
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-amber-50 border-amber-200'
                }`}
              >
                <p
                  className={`text-sm font-semibold ${
                    grade.is_correct ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {grade.is_correct ? '✓ ' : '💡 '}
                  {grade.feedback}
                </p>
                {grade.suggestion ? (
                  <p className="mt-1.5 text-sm text-amber-700/90">{grade.suggestion}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      }

      case 'self_check':
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-base font-semibold text-on-surface mb-3">自我檢核</p>
            <div className="space-y-2">
              {block.items.map((item, ii) => {
                const checks = (blockState[key] as boolean[]) ?? [];
                return (
                  <label key={ii} className="flex items-start gap-2 text-base cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!checks[ii]}
                      onChange={(e) => {
                        const next = [...checks];
                        next[ii] = e.target.checked;
                        while (next.length < block.items.length) next.push(false);
                        setBlockValue(key, next);
                        if (next.filter(Boolean).length >= block.items.length) {
                          setFeedback((prev) => ({ ...prev, [key]: true }));
                          checkCompletion({ ...blockState, [key]: next });
                        }
                      }}
                      className="mt-0.5"
                    />
                    <span>{item}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );

      case 'ordering': {
        // 排序題。The sentences live in a 2-column table in the DOCX — one column of
        // 「（ N ）」 slots, one of sentences — and used to be classified as a figure
        // with a table referent, which the loader drops when it has no asset.
        //
        // 拖拉，不打字（2026-08-19 Young：「我覺得用戶不會填寫，所以才要用拖拉」）。
        // 原本每句前面是一個文字框要學生自己判斷順序再打 1~4 —— 小學生不會這樣做，
        // 他會空著或亂填，整題等於沒作用。
        //
        // 答案（`answer` / `correct_order`）只在按下送出之後用來判分，任何時候都不渲染。
        return (
          <OrderingBlock
            key={key}
            items={block.items ?? []}
            state={blockState[key] as OrderingBlockState | undefined}
            onChange={(next) => setBlockValue(key, next)}
            onSubmitted={(next) => {
              setBlockValue(key, next);
              checkCompletion({ ...blockState, [key]: next });
            }}
          />
        );
      }

      case 'figure':
        return <div key={key}>{renderFigure(block)}</div>;

      case 'fill_table':
        // ⚠️ `fill_table` 有兩種用途，差別在它自己帶不帶 rows：
        //    (a) 沒有 rows ＝ 指路牌，內容其實住在「文章重點表」那一步
        //    (b) 有 rows ＝ 這張表**就住在聚光燈裡**（L0034 的策略對照表）
        //    以前一律當 (a)，於是 (b) 的整張表被換成一句「請到重點表填寫」——
        //    而那一步根本沒有這張表，學生照著指路牌走過去會撲空。
        if (!((block as { rows?: unknown[] }).rows ?? []).length) {
          return (
            <div
              key={key}
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-base text-blue-900"
            >
              文章重點表請在「文章重點表」步驟填寫
              {onOpenKeypoints ? (
                <button
                  type="button"
                  onClick={onOpenKeypoints}
                  className="ml-3 underline text-blue-700"
                >
                  前往重點表
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setBlockValue(key, true);
                  checkCompletion({ ...blockState, [key]: true });
                }}
                className="ml-3 underline text-blue-700"
              >
                知道了
              </button>
            </div>
          );
        }
      // 帶 rows 的 fill_table 走下面同一套表格繪製
      // falls through
      case 'table': {
        // The extractor labelled image-less tables as `figure` with `referent: 'table'`,
        // and the loader drops a figure with no asset — 217 tables across 109 lessons
        // disappeared, leaving a prompt followed by nothing. They arrive as rows now.
        //
        // Cells carry 【】 where the student writes. This is the TEACHER's copy, so the
        // extractor empties them and keeps the values in `answers`, which is never
        // rendered — the same arrangement `ordering` uses for `correct_order`.
        // ⚠️ `rows` 有兩種形狀，而且混在同一批資料裡：
        //    (a) 陣列的陣列 —— `[["指示代詞","作用"], ["之、此","指近的"]]`
        //    (b) 以欄名為 key 的物件 + 另一個 `columns` —— 多模態抽取寫這種
        //    直接對 (b) 做 `row.map` 會丟 `v.map is not a function`，
        //    而那不是「這一格畫不出來」，是**整個聚光燈步驟白屏**。
        //    2026-08-17 preview 實測：文-L6 的聚光燈就是這樣整頁掛掉的。
        const rawRows = (block.rows ?? []) as unknown[];
        const columns = ((block as { columns?: unknown }).columns ?? []) as unknown[];
        const cellText = (v: unknown) =>
          // 一格裡可以有多個例句（`["學而時習之","此物最相思"]`），換行排比較好讀
          Array.isArray(v) ? v.map(x => String(x ?? '')).join('\n') : String(v ?? '');
        const isKeyed = rawRows.some(
          r => r !== null && typeof r === 'object' && !Array.isArray(r),
        );
        const header = isKeyed && columns.length ? [columns.map(c => String(c))] : [];
        const rows: string[][] = [
          ...header,
          ...rawRows.map(r =>
            Array.isArray(r)
              ? r.map(cellText)
              : columns.length
                ? columns.map(c => cellText((r as Record<string, unknown>)?.[String(c)]))
                : Object.values((r ?? {}) as Record<string, unknown>).map(cellText),
          ),
        ];
        const answers = (blockState[key] as Record<string, string>) ?? {};
        let blankNo = 0;
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-4">
            {/* Wide tables scroll inside their own box; the page never scrolls sideways. */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-base">
                <tbody>
                  {rows.map((row, r) => (
                    <tr key={r} className={r === 0 ? 'bg-gray-50 font-medium' : ''}>
                      {row.map((cell, c) => (
                        <td key={c} className="border border-gray-200 px-3 py-2 align-top whitespace-pre-wrap">
                          {String(cell).split('【】').map((part, i, all) => {
                            if (i === all.length - 1) return <span key={i}>{part}</span>;
                            const slot = `${r}-${c}-${i}`;
                            blankNo += 1;
                            return (
                              <span key={i}>
                                {part}
                                <input
                                  type="text"
                                  aria-label={`第 ${blankNo} 個空格`}
                                  value={answers[slot] ?? ''}
                                  onChange={e => {
                                    const next = { ...answers, [slot]: e.target.value };
                                    setBlockValue(key, next);
                                    checkCompletion({ ...blockState, [key]: next });
                                  }}
                                  className="mx-1 min-w-[5rem] border-b border-gray-400 bg-transparent px-1 focus:outline-none focus:border-blue-500"
                                />
                              </span>
                            );
                          })}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'multi': {
        const options = toOptionList(block.options);
        const selected = (blockState[key] as number[] | undefined) ?? [];
        const toggle = (oi: number) =>
          setBlockValue(key, selected.includes(oi) ? selected.filter((x) => x !== oi) : [...selected, oi]);
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-base font-medium text-on-surface mb-1 whitespace-pre-wrap">{promptOf(block)}</p>
            <p className="text-sm text-on-surface-variant mb-3">可以選一個以上</p>
            <div className="space-y-2">
              {options.map((opt, oi) => (
                <button
                  key={oi}
                  type="button"
                  role="checkbox"
                  aria-checked={selected.includes(oi)}
                  disabled={fb !== undefined && fb !== null}
                  onClick={() => toggle(oi)}
                  className={[
                    'w-full text-left rounded-lg border px-4 py-2.5 text-base transition-colors',
                    selected.includes(oi)
                      ? 'border-violet-500 bg-violet-50 text-violet-900'
                      : 'border-gray-200 hover:border-violet-300',
                  ].join(' ')}
                >
                  <span aria-hidden className="mr-2">{selected.includes(oi) ? '☑' : '☐'}</span>
                  {String.fromCharCode(65 + oi)}. {opt}
                </button>
              ))}
            </div>
            {fb === null || fb === undefined ? (
              <button
                type="button"
                onClick={() => handleMultiSubmit(segIdx, blockIdx, block)}
                disabled={selected.length === 0}
                className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600 disabled:opacity-40"
              >
                確認
              </button>
            ) : (
              <p className={`mt-3 text-base font-medium ${fb ? 'text-green-700' : 'text-amber-700'}`}>
                {fb ? '✓ 已作答' : '再想想看'}
              </p>
            )}
          </div>
        );
      }

      // 策略說明框：每課聚光燈的開場白，純閱讀不作答。
      // 舊抽取把它壓成 guide 文字流，說明與題目混在一起分不出來。
      case 'concept_box': {
        const cb = block as unknown as SpotlightConceptBoxBlock;
        return (
          <div key={key} className="rounded-xl border-2 border-violet-200 bg-violet-50/60 px-5 py-4">
            {cb.label ? (
              <div className="text-sm font-semibold text-violet-700 mb-2">{cb.label}</div>
            ) : null}
            <p className="text-base text-on-surface leading-relaxed whitespace-pre-wrap">{cb.text}</p>
          </div>
        );
      }

      // 連連看。教師版的答案是紅色連線 —— 圖形，不在 DOCX 文字流裡，
      // 所以只有多模態讀得到。學生端用下拉挑對應項，不做拖拉。
      case 'matching': {
        const mb = block as unknown as SpotlightMatchingBlock;
        const picks = (blockState[key] as Record<string, string> | undefined) ?? {};
        const right = mb.right ?? {};
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            {mb.label ? <div className="text-sm font-semibold text-violet-700 mb-1">{mb.label}</div> : null}
            {mb.instruction ? (
              <p className="text-base text-on-surface mb-3 whitespace-pre-wrap">{mb.instruction}</p>
            ) : null}
            <div className="space-y-3">
              {Object.entries(mb.left ?? {}).map(([lk, lv]) => (
                <div key={lk} className="rounded-lg border border-gray-200 p-3">
                  <div className="text-base font-medium text-on-surface mb-2">{lk}. {lv}</div>
                  <label className="text-sm text-on-surface-variant">
                    對應到：
                    <select
                      className="ml-2 rounded border border-gray-300 px-2 py-1 text-base"
                      value={picks[lk] ?? ''}
                      onChange={(e) => {
                        const next = { ...picks, [lk]: e.target.value };
                        setBlockValue(key, next);
                        checkCompletion({ ...blockState, [key]: next });
                      }}
                    >
                      <option value="">請選擇</option>
                      {Object.entries(right).map(([rk, rv]) => (
                        <option key={rk} value={rk}>{rk}. {rv}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      }

      // 巢狀小題（一、→（一）→ 1.2.3.）。學習單本來就是這個形狀；
      // 舊抽取沒有遞迴，把它壓平成一串 guide + free_text，層級全部消失。
      case 'sub_block':
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            {renderSubBlock(block as unknown as Parameters<typeof renderSubBlock>[0], `${key}-s`, 0)}
          </div>
        );

      // 小試身手：打勾表格 ＋ 填代號，兩種練習共用一個容器。
      //
      // #3559 現場老師回報《感情小日記1》「聚光燈沒有選項可以點」。真環境重現
      // （lesson 20017）發現兩個缺陷疊在一起：① 這裡以前只讀 `it.stem`，但這一
      // 課的資料是 `it.prompt` —— 題目本身整段印不出來，畫面只看得到「1.2.3.…」
      // 的編號 ② 就算題目印得出來，每一題也完全沒有可以點的東西：`option_bank`
      // 只是印在最上面的代號表，跟底下每一題毫無連動。
      //
      // 這個 block 明印「沒有標準答案」（`note` 欄逐字寫著），所以不比對對錯 ——
      // 只需要讓每一題都能從 `option_bank` 選一個，選了要看得出來選了哪個。
      // 題目自己帶 `options`/`answer`（另一種 exercise 資料形狀，本次沒有真實
      // 案例回報）維持原本的純文字渲染，不在這次修復範圍內。
      case 'exercise': {
        const ex = block as unknown as SpotlightExerciseBlock;
        const bank = ex.option_bank ? Object.entries(ex.option_bank) : [];
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            {ex.label ? <div className="text-sm font-semibold text-violet-700 mb-1">{ex.label}</div> : null}
            {ex.prompt ? (
              <p className="text-base font-medium text-on-surface mb-3 whitespace-pre-wrap">{ex.prompt}</p>
            ) : null}
            {ex.instruction ? (
              <p className="text-base text-on-surface mb-3 whitespace-pre-wrap">{ex.instruction}</p>
            ) : null}
            {ex.option_bank ? (
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-gray-50 p-3">
                {bank.map(([k, v]) => (
                  <span key={k} className="text-base text-on-surface">{k}. {v}</span>
                ))}
              </div>
            ) : null}
            {(ex.items ?? []).map((it, i) => {
              const text = promptOf(it);
              const hasOwnOptions = Boolean(it.options);
              const itemKey = `${key}-item-${i}`;
              const picked = blockState[itemKey] as string | undefined;
              return (
                <div key={i} className="flex flex-col gap-1.5 py-1.5 border-t border-gray-100 first:border-t-0">
                  <div className="flex items-start gap-2">
                    <span className="text-base text-on-surface-variant shrink-0">{it.index ?? i + 1}.</span>
                    <span className="text-base text-on-surface whitespace-pre-wrap">{text}</span>
                  </div>
                  {!hasOwnOptions && bank.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pl-5">
                      {bank.map(([bk, bv]) => (
                        <button
                          key={bk}
                          type="button"
                          aria-pressed={picked === bk}
                          onClick={() => setBlockValue(itemKey, bk)}
                          className={[
                            'rounded-full border px-3 py-1 text-sm transition-colors',
                            picked === bk
                              ? 'border-violet-500 bg-violet-50 text-violet-900'
                              : 'border-gray-200 hover:border-violet-300',
                          ].join(' ')}
                        >
                          {bv}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      }

      default:
        return (
          <div key={key} className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-3 text-base text-on-surface-variant">
            {(block as { text?: string; prompt?: string }).text ??
              (block as { prompt?: string }).prompt ??
              `[${block.type}]`}
          </div>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      <header className="border-b border-gray-200 pb-4">
        <div className="text-sm font-semibold text-violet-600 tracking-wide">閱讀聚光燈</div>
        <h2 className="text-xl font-bold text-on-surface mt-1">{spotlight.strategy_name}</h2>
      </header>

      {segments.slice(0, visibleSegmentCount).map((segment, segIdx) => {
        const indexed = segment.map((block, blockIdx) => ({ block, blockIdx }));
        const hasPassage = segment.some((b) => b.type === 'passage');
        const contextBlocks = indexed.filter(({ block }) => !isInteractiveBlock(block.type));
        const exerciseBlocks = indexed.filter(({ block }) => isInteractiveBlock(block.type));

        return (
          <section key={segIdx} className="space-y-4">
            {segIdx > 0 ? (
              <div className="text-sm font-semibold text-on-surface-variant pt-2 border-t border-gray-100">
                第 {segIdx + 1} 部分
              </div>
            ) : null}
            {hasPassage && exerciseBlocks.length > 0 ? (
              <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:gap-6 lg:items-start">
                <div className="lg:col-span-3 space-y-4 lg:sticky lg:top-4">
                  {contextBlocks.map(({ block, blockIdx }) => renderBlock(block, segIdx, blockIdx))}
                </div>
                <div className="lg:col-span-2 space-y-4">
                  {exerciseBlocks.map(({ block, blockIdx }) => renderBlock(block, segIdx, blockIdx))}
                </div>
              </div>
            ) : (
              segment.map((block, blockIdx) => renderBlock(block, segIdx, blockIdx))
            )}
          </section>
        );
      })}

      {allDone ? (
        <p className="text-center text-base font-medium text-green-700 py-4">✓ 閱讀聚光燈練習完成</p>
      ) : null}

      {story && story.content.length > 0 ? (
        <details className="rounded-lg border border-gray-200 bg-surface-container-low p-3 text-base">
          <summary className="cursor-pointer font-medium text-on-surface-variant">
            需要時查看本課課文全文
          </summary>
          <div className="mt-3 space-y-2 text-on-surface leading-relaxed">
            {story.content.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
};

export default BlockSequenceRenderer;
