/**
 * WordBabiesLab — "我的文字寶貝" (#3780).
 *
 * /lab-only page (not wired into the main navigation per team-lead
 * instruction 2026-10-27): shows the student's own word-baby collection —
 * a 100-cell dex (silhouette + rarity for species never caught), owned-pet
 * cards (stage, dormancy countdown, weaken state), the 5-flavor fragment
 * wallet, and a feed button per owned baby.
 *
 * G6 兒童文案: all wording here targets 國小四年級識字程度 — short
 * sentences, no idioms, and (platform-wide rule, design.md §0) absolutely
 * no "死亡/掛掉" words or imagery; a neglected pet "躲起來了", it never dies.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMyWordBabies, feedWordBaby } from '../../services/wordBabyApi';
import type { MyWordBabiesResponse, WordBabySummary } from '../../services/wordBabyApi';
import {
  allCatalogEntries,
  getCatalogEntry,
  computeFeedability,
  weakenStateBadge,
  weakenStateRecoveryHint,
  dormantTypeLabel,
  dietFlavorsList,
  feedShortfallLines,
  babyIcon,
  stageName,
  FLAVOR_FAMILIES,
  type CatalogBaby,
} from './wordBabies/wordBabyDomain';

// 預設只顯示前兩排（桌機 10 欄、手機 8 欄，取較大值的兩倍留一點餘裕）—
// team-lead 2026-10-27 feedback #1：100 格問號不該是進頁面第一眼看到的東西。
const DEX_COLLAPSED_COUNT = 20;

const RARITY_COLOR: Record<CatalogBaby['rarity'], string> = {
  common: 'border-gray-300 bg-gray-50 text-gray-600',
  uncommon: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  rare: 'border-sky-300 bg-sky-50 text-sky-700',
  epic: 'border-violet-300 bg-violet-50 text-violet-700',
  legendary: 'border-amber-300 bg-amber-50 text-amber-700',
};

const RARITY_ZH: Record<CatalogBaby['rarity'], string> = {
  common: '常見', uncommon: '少見', rare: '稀有', epic: '史詩', legendary: '傳說',
};

export default function WordBabiesLab() {
  const { user, token } = useAuth();
  const [data, setData] = useState<MyWordBabiesResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [feedingId, setFeedingId] = useState<string | null>(null);
  const [feedError, setFeedError] = useState('');
  const [dexExpanded, setDexExpanded] = useState(false);

  // 依賴用 user?.id（primitive）不用 user（object）——有些 useAuth() 實作
  // （含測試用的 mock）每次 render 都回傳新的物件字面值，若依賴整個物件，
  // useCallback 每次都會重建、觸發下面的 useEffect 再跑一次，造成無限
  // fetch。依 id 這個 primitive 比對才穩定。
  const studentId = user?.id;

  const load = useCallback(async () => {
    if (!studentId || !token) return;
    try {
      setLoadError('');
      const result = await fetchMyWordBabies(studentId, token);
      setData(result);
    } catch {
      setLoadError('連不上文字寶貝的家，等一下再試一次');
    }
  }, [studentId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFeed = useCallback(
    async (babyId: string) => {
      if (!studentId || !token) return;
      setFeedingId(babyId);
      setFeedError('');
      try {
        await feedWordBaby(studentId, babyId, token);
        await load();
      } catch {
        setFeedError('餵食失敗了，等一下再試一次');
      } finally {
        setFeedingId(null);
      }
    },
    [studentId, token, load],
  );

  const ownedByBabyId = new Map<string, WordBabySummary>((data?.babies ?? []).map((b) => [b.baby_id, b]));
  const wallet = data?.wallet ?? {};

  // team-lead 2026-10-27 feedback #2: highlight the wallet cell(s) that
  // matter right now — the union of diet flavors across every owned baby
  // that can actually still be fed (not dormant, not fully grown; those
  // don't need fragments at all).
  const neededFlavors = useMemo(() => {
    const flavors = new Set<string>();
    for (const baby of data?.babies ?? []) {
      if (baby.dormant_type !== null || baby.fully_grown) continue;
      const entry = getCatalogEntry(baby.baby_id);
      entry?.diet_flavors.forEach((f) => flavors.add(f));
    }
    return flavors;
  }, [data]);

  return (
    <div className="min-h-screen bg-white text-gray-900 px-4 py-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-4">
        <Link to="/" className="text-accent font-bold text-lg whitespace-nowrap">
          ← 返回首頁
        </Link>
        <h1 className="text-xl font-bold">我的文字寶貝</h1>
      </div>

      <p className="text-gray-600 text-base mb-4">
        讀課文、完成題目，就有機會撿到碎片或遇到新的文字寶貝！
      </p>

      {loadError && (
        <p role="alert" className="text-red-600 mb-4">{loadError}</p>
      )}

      {!data && !loadError && (
        <p className="text-gray-500">正在打開你的文字寶貝圖鑑……</p>
      )}

      {data && (
        <>
          {/* team-lead 2026-10-27 feedback #1：最重要的「我養的寶貝」放最上面，
              圖鑑 100 格問號不該是進頁面第一眼看到的東西。 */}
          <section className="mb-6">
            <h2 className="text-lg font-bold mb-2">我養的寶貝</h2>
            {feedError && <p role="alert" className="text-red-600 mb-2">{feedError}</p>}
            {data.babies.length === 0 && (
              <p className="text-gray-500">你還沒有抓到任何文字寶貝，繼續讀課文看看吧！</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.babies.map((baby) => (
                <MyBabyCard
                  key={baby.baby_id}
                  baby={baby}
                  wallet={wallet}
                  feeding={feedingId === baby.baby_id}
                  onFeed={() => handleFeed(baby.baby_id)}
                />
              ))}
            </div>
          </section>

          <section className="mb-6">
            <h2 className="text-lg font-bold mb-2">碎片背包</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {FLAVOR_FAMILIES.map((flavor) => {
                const needed = neededFlavors.has(flavor);
                return (
                  <div
                    key={flavor}
                    data-testid={`wallet-flavor-${flavor}`}
                    data-needed={needed ? 'true' : 'false'}
                    className={`rounded-lg border px-3 py-2 flex items-center justify-between ${
                      needed
                        ? 'border-accent bg-accent/10 ring-2 ring-accent'
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <span className="text-sm text-gray-700">{flavor}</span>
                    <span className="font-bold text-accent">{wallet[flavor] ?? 0} 片</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mb-6">
            <h2 className="text-lg font-bold mb-2">
              圖鑑 {data.babies_owned_count}/{data.babies_total_species} 隻
            </h2>
            <DexGrid owned={ownedByBabyId} limit={dexExpanded ? undefined : DEX_COLLAPSED_COUNT} />
            {!dexExpanded && (
              <button
                type="button"
                onClick={() => setDexExpanded(true)}
                className="mt-2 text-accent font-bold text-sm"
              >
                看全部 100 隻
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function DexGrid({ owned, limit }: { owned: Map<string, WordBabySummary>; limit?: number }) {
  // team-lead 2026-10-27 feedback #1: collapsed by default — `limit` undefined
  // means "show all 100" (after the student taps 看全部 100 隻).
  const entries = limit === undefined ? allCatalogEntries() : allCatalogEntries().slice(0, limit);
  return (
    <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
      {entries.map((entry) => {
        const ownedBaby = owned.get(entry.id);
        const colorClass = RARITY_COLOR[entry.rarity];
        if (!ownedBaby) {
          return (
            <div
              key={entry.id}
              title={`${RARITY_ZH[entry.rarity]}寶貝，還沒抓到`}
              className={`aspect-square rounded-md border ${colorClass} flex items-center justify-center text-sm opacity-60`}
            >
              ❔
            </div>
          );
        }
        return (
          <div
            key={entry.id}
            title={entry.name}
            className={`aspect-square rounded-md border-2 ${colorClass} flex items-center justify-center text-base font-bold`}
          >
            {babyIcon(ownedBaby)}
          </div>
        );
      })}
    </div>
  );
}

function MyBabyCard({
  baby,
  wallet,
  feeding,
  onFeed,
}: {
  baby: WordBabySummary;
  wallet: Record<string, number>;
  feeding: boolean;
  onFeed: () => void;
}) {
  const entry = getCatalogEntry(baby.baby_id);
  if (!entry) return null; // 設定檔跟 DB 對不上時安靜略過，不讓整頁崩掉

  const weakBadge = weakenStateBadge(baby.weaken_state);
  const recoveryHint = weakenStateRecoveryHint(baby.weaken_state);
  const { canFeed, fragmentsStillNeeded, outstandingFlavors } = computeFeedability(baby, entry, wallet);

  return (
    <div className={`rounded-xl border-2 p-4 ${RARITY_COLOR[entry.rarity]}`}>
      <div className="flex items-start gap-3 mb-1">
        {/* team-lead 2026-10-27 feedback #4：卡片上看不到寶貝本人，放大圖示 */}
        <span
          data-testid={`baby-card-icon-${baby.baby_id}`}
          className="text-4xl leading-none"
          aria-hidden="true"
        >
          {babyIcon(baby)}
        </span>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-lg">{baby.name}</span>
            <span className="text-xs rounded-full px-2 py-0.5 bg-white/70 border">{RARITY_ZH[entry.rarity]}</span>
          </div>
          {/* team-lead 2026-10-27：沒說寶貝吃哪種碎片 → 每種口味一個小標籤，
              字級跟內文一樣大（原本太小、擠成兩行） */}
          <div className="flex items-center flex-wrap gap-1 mt-1">
            <span className="text-sm text-gray-700">愛吃：</span>
            {dietFlavorsList(entry).map((flavor) => (
              <span
                key={flavor}
                className="text-sm rounded-full px-2 py-0.5 bg-white/70 border border-gray-300 text-gray-700"
              >
                {flavor}
              </span>
            ))}
          </div>
        </div>
      </div>

      {weakBadge && (
        <p className="text-sm text-orange-600 mb-1">{weakBadge}</p>
      )}
      {recoveryHint && (
        <p className="text-sm text-gray-500 mb-1">{recoveryHint}</p>
      )}

      {baby.dormant_type !== null ? (
        <>
          <p className="text-sm text-gray-700 mb-1">{dormantTypeLabel(baby.dormant_type)}</p>
          {baby.hatch_days_remaining !== null && (
            <p className="text-sm text-gray-500">還要等 {baby.hatch_days_remaining} 天才會孵化</p>
          )}
        </>
      ) : baby.fully_grown ? (
        <p className="text-sm text-gray-700">已經長大囉，是最終型態的「{stageName(entry, baby.stage_index)}」</p>
      ) : (
        <>
          <p className="text-sm text-gray-700 mb-2">
            目前型態：{stageName(entry, baby.stage_index)}（第 {baby.stage_index}/{entry.stage_count} 階段）
          </p>
          {fragmentsStillNeeded > 0 && (() => {
            // team-lead 2026-10-27：不要只有灰掉的按鈕，要說還差多少、去做
            // 什麼才拿得到——round 2 拆成兩行短句，口味名字不用再列一次
            // （愛吃標籤跟背包標亮已經看得到了）。
            const { countLine, actionLine } = feedShortfallLines(fragmentsStillNeeded, outstandingFlavors);
            return (
              <p className="text-sm text-gray-500 mb-2">
                {countLine}
                <br />
                {actionLine}
              </p>
            );
          })()}
          <button
            type="button"
            onClick={onFeed}
            disabled={!canFeed || feeding}
            className="w-full rounded-lg bg-accent disabled:bg-gray-300 disabled:text-gray-500 text-white font-bold py-2 transition-colors"
          >
            {feeding ? '餵食中……' : '餵食'}
          </button>
        </>
      )}
    </div>
  );
}
