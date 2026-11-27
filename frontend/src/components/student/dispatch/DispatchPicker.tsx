/**
 * DispatchPicker — 「AI 派發」：每次給 2 課擇 1，標示為什麼推這兩課，可「再派一組」（#4161）
 *
 * 推薦規則沿用現有後端（年級、弱項、體裁；沒有紀錄的新生依年級預設），不新做能力估計。
 * 首頁、課文清單頂端的入口卡與報告頁底部共用這一個元件。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { getStoryRecommendations } from '../../../services/progressApi';
import { gradeLabel } from '../../../utils/gradeLabel';
import { stepPath } from '../../../config/stepPath';
import { pickPair, type DispatchRec } from './pickPair';

/** 一次向後端要的推薦數；夠「再派一組」換好幾輪 */
const FETCH_LIMIT = 12;

interface Props {
  /** 剛做完的這一課：不會再派給學生（報告頁用） */
  excludeSlug?: string;
  /** 一進來就派第一組（入口卡展開時、報告頁按下「再派一組」後用） */
  autoStart?: boolean;
}

const DispatchPicker: React.FC<Props> = ({ excludeSlug, autoStart = true }) => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id;
  const [recs, setRecs] = useState<DispatchRec[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<string[]>([]);
  const [started, setStarted] = useState(autoStart);

  const load = useCallback(() => {
    if (!token || userId === undefined) return;
    setFailed(false);
    getStoryRecommendations(token, userId, FETCH_LIMIT)
      .then((d) => setRecs(d.recommendations))
      .catch(() => setFailed(true));
  }, [token, userId]);

  useEffect(() => {
    if (started && recs === null) load();
  }, [started, recs, load]);

  // 目前這一組 = 排除已派過的與剛做完的之後的前兩課；派完一輪再從頭
  const pair = useMemo(() => {
    if (!recs) return [];
    const p = pickPair(recs, shown, excludeSlug);
    return p.length ? p : pickPair(recs, [], excludeSlug);
  }, [recs, shown, excludeSlug]);

  const another = () => {
    if (!started) { setStarted(true); return; }
    if (!recs) return;
    const next = [...shown, ...pair.map((r) => r.story_slug)];
    // 派完一輪：清空已派過的，回到第一組；不清的話之後每按一次都把第一組再加進去，永遠停在第一組
    setShown(pickPair(recs, next, excludeSlug).length ? next : []);
  };

  if (!started) {
    return (
      <button
        type="button"
        onClick={another}
        className="h-11 px-8 rounded-full bg-accent text-white font-bold hover:bg-accent-hover"
      >
        再派一組
      </button>
    );
  }
  if (failed) {
    return (
      <p className="text-sm text-on-surface-variant" role="status">
        暫時派不出課文，<button type="button" className="underline font-bold" onClick={load}>再試一次</button>
      </p>
    );
  }
  if (recs === null) {
    return <p className="text-sm text-on-surface-variant" role="status">AI 正在幫你挑課…</p>;
  }
  if (!pair.length) {
    return <p className="text-sm text-on-surface-variant">目前沒有可以派的課，去圖書館自己挑一課吧</p>;
  }

  return (
    <div data-testid="dispatch-picker">
      <ul className="grid sm:grid-cols-2 gap-3">
        {pair.map((r) => (
          <li key={r.story_slug} className="rounded-2xl border border-[#E5E0D5] bg-surface-container-lowest p-4 flex flex-col gap-2" data-testid="dispatch-card">
            <h4 className="font-headline font-bold text-on-surface">{r.title}</h4>
            <p className="text-xs text-on-surface-variant">
              {Number.isFinite(r.grade) ? gradeLabel(String(r.grade)) : ''}{r.genre ? `・${r.genre}` : ''}
            </p>
            <p className="text-sm text-on-surface" data-testid="dispatch-reason">為什麼推這課：{r.reason}</p>
            <button
              type="button"
              onClick={() => navigate(stepPath(r.story_slug, 'lesson-intro'))}
              className="mt-auto h-10 rounded-full bg-accent text-white font-bold hover:bg-accent-hover"
            >
              選這課開始
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-center">
        <button type="button" onClick={another} className="text-sm font-bold text-accent underline">
          再派一組
        </button>
      </div>
    </div>
  );
};

export default DispatchPicker;
