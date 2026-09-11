/**
 * /help 使用說明（#3142 重做）
 *
 * 重做前的四個問題，以及這一版怎麼處理：
 *
 *   1. 沒有入口 —— 全 repo 沒有任何 UI 連到 /help
 *      → 老師與學生側邊欄都加了「使用說明」（`TeacherSidebar` / `StudentSidebar`）
 *   2. 內容硬編且過期 —— 寫 57 篇課文、六個學習步驟、教兩個已停用的關卡
 *      → 關卡清單改成從 `stepConfig` 推導、課文總數改成從 API 的 `total` 取
 *   3. 底部四個「完整手冊」連結全是 404（指向不存在的 `/docs/manuals/*.md`）
 *      → 移除
 *   4. 對象混雜 —— 管理員分頁放 gcloud / CI-CD 工程 runbook
 *      → 搬到 `docs/production/deployment-guide.md`，這裡只留老師與學生
 *
 * 版面沿用原本的優點（角色分頁 + 手風琴，收起來是一份乾淨的問題清單），
 * 另外加了跨角色搜尋與展開／收合全部。
 *
 * 文案風格：網頁 UI 不加句號。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  HELP_CONTENT,
  HELP_DEVICES,
  HELP_ROLE_ORDER,
  entryHaystack,
  type HelpDevice,
  type HelpEntry,
  type HelpRole,
} from './help/helpContent';
import { resolveActiveSteps } from '../config/stepConfig';

/** 一則問答 */
const Entry: React.FC<{
  entry: HelpEntry;
  roleLabel?: string;
  open: boolean;
  onToggle: () => void;
  device: HelpDevice;
  onZoom: (src: string, alt: string) => void;
}> = ({ entry, roleLabel, open, onToggle, device, onZoom }) => (
  <div className="border-b border-slate-200 last:border-b-0">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-slate-50"
    >
      <span className="text-[17px] font-medium text-slate-800">
        {entry.q}
        {roleLabel && (
          <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {roleLabel}
          </span>
        )}
      </span>
      <span aria-hidden className="shrink-0 text-slate-400">{open ? '−' : '+'}</span>
    </button>

    {open && (
      <div data-help-answer="open" className="px-4 pb-5 text-[16px] leading-8 text-slate-700">
        {entry.steps && (
          <ol className="ml-5 list-decimal space-y-1.5">
            {entry.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        )}
        {entry.note && (
          <p className="mt-3 whitespace-pre-line">{entry.note}</p>
        )}
        {entry.gotcha && (
          <p className="mt-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3">
            <span className="font-medium text-amber-900">容易踩的地方　</span>
            <span className="text-amber-900">{entry.gotcha}</span>
          </p>
        )}

        {/* 實機截圖（#3151）。紅框是在截圖時注入 DOM 畫上去的，不是事後加的圖層。 */}
        {(entry.shots || []).map((id) => {
          const src = `/help-shots/${id}-${device}.png`;
          const alt = `${entry.q}（${HELP_DEVICES[device].label}畫面，紅框標示要點）`;
          return (
            <figure key={id} className="mt-4">
              <button
                type="button"
                onClick={() => onZoom(src, alt)}
                className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-white"
                aria-label={`放大檢視：${alt}`}
              >
                <img
                  data-help-shot={id}
                  src={src}
                  alt={alt}
                  loading="lazy"
                  className="block w-full"
                />
              </button>
              <figcaption className="mt-1.5 text-[13px] text-slate-500">
                點圖可放大　·　{HELP_DEVICES[device].label}
              </figcaption>
            </figure>
          );
        })}
      </div>
    )}
  </div>
);

const HelpPage: React.FC = () => {
  const navigate = useNavigate();
  const [role, setRole] = useState<HelpRole>('teacher');
  const [query, setQuery] = useState('');
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [storyTotal, setStoryTotal] = useState<number | null>(null);
  const [device, setDevice] = useState<HelpDevice>('desktop');
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  // Escape 關掉放大檢視。孩子會用 iPad，但老師多半用鍵盤。
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoom]);

  // 課文總數一律問 API —— 這個數字曾經以「57 篇」的字面值躺在這頁上很久
  useEffect(() => {
    let alive = true;
    const base = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL || '';
    fetch(`${base}/api/stories?page_size=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && typeof d.total === 'number') setStoryTotal(d.total); })
      .catch(() => { /* 取不到就不顯示數字，不要編一個 */ });
    return () => { alive = false; };
  }, []);

  const activeSteps = useMemo(() => resolveActiveSteps(), []);

  const searching = query.trim().length > 0;

  /** 搜尋時跨角色一起找；沒搜尋就只看當前分頁 */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const roles = searching ? HELP_ROLE_ORDER : [role];
    const out: Array<{ key: string; roleLabel?: string; section: string; entry: HelpEntry }> = [];
    for (const r of roles) {
      const c = HELP_CONTENT[r];
      for (const sec of c.sections) {
        for (const [i, entry] of sec.entries.entries()) {
          if (q && !entryHaystack(entry).toLowerCase().includes(q)) continue;
          out.push({
            key: `${r}:${sec.title}:${i}`,
            roleLabel: searching ? c.label : undefined,
            section: sec.title,
            entry,
          });
        }
      }
    }
    return out;
  }, [query, role, searching]);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof visible>();
    for (const v of visible) {
      if (!m.has(v.section)) m.set(v.section, []);
      m.get(v.section)!.push(v);
    }
    return Array.from(m.entries());
  }, [visible]);

  const allOpen = visible.length > 0 && visible.every((v) => openKeys.has(v.key));
  const toggleAll = () =>
    setOpenKeys(allOpen ? new Set() : new Set(visible.map((v) => v.key)));

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div className="min-h-screen bg-[#fafaf8]">
      <div className="mx-auto max-w-[820px] px-5 py-10">
        <header className="mb-8">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-4 text-[15px] text-slate-500 hover:text-slate-700"
          >
            ← 回上一頁
          </button>
          <h1 className="text-[32px] font-bold text-slate-900">使用說明</h1>
          <p className="mt-2 text-[17px] leading-8 text-slate-600">
            挑一個問題點開，裡面是照順序寫的步驟
            {storyTotal !== null && (
              <>
                <br />
                目前平台上有 <strong>{storyTotal}</strong> 篇課文，涵蓋第 4 到第 9 級、品格教育與文言文
              </>
            )}
          </p>
        </header>

        <div className="mb-5">
          <input
            type="search"
            role="searchbox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋問題，例如：麥克風、加入班級、作業"
            aria-label="搜尋使用說明"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-500"
          />
          {searching && (
            <p className="mt-2 text-[14px] text-slate-500">
              搜尋會同時找老師與學生兩邊的問題
            </p>
          )}
        </div>

        {/* 裝置切換（#3151）。只有兩種版本，理由見 helpContent.ts 的 HELP_DEVICES。 */}
        <div
          role="group"
          aria-label="截圖的裝置版本"
          className="mb-4 flex items-center gap-2 text-[15px]"
        >
          <span className="text-slate-500">截圖畫面</span>
          {(Object.keys(HELP_DEVICES) as HelpDevice[]).map((d) => {
            const active = d === device;
            return (
              <button
                key={d}
                role="radio"
                aria-checked={active}
                onClick={() => setDevice(d)}
                className={
                  'rounded-lg border px-3 py-1.5 '
                  + (active
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
                }
              >
                {HELP_DEVICES[d].label}
              </button>
            );
          })}
        </div>

        {!searching && (
          <div role="tablist" aria-label="選擇對象" className="mb-4 flex gap-2">
            {HELP_ROLE_ORDER.map((r) => {
              const c = HELP_CONTENT[r];
              const active = r === role;
              return (
                <button
                  key={r}
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setRole(r); setOpenKeys(new Set()); }}
                  className={
                    'rounded-xl border px-4 py-2 text-[16px] '
                    + (active
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
                  }
                >
                  <span aria-hidden className="mr-1.5">{c.icon}</span>
                  {c.label}
                </button>
              );
            })}
          </div>
        )}

        {!searching && (
          <p className="mb-5 text-[15px] text-slate-500">{HELP_CONTENT[role].blurb}</p>
        )}

        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={toggleAll}
            className="text-[15px] text-slate-600 underline hover:text-slate-900"
          >
            {allOpen ? '收合全部' : '展開全部'}
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-[16px] text-slate-500">
            找不到符合「{query.trim()}」的問題
            <br />
            試試更短的字，例如「麥克風」或「班級」
          </p>
        ) : (
          grouped.map(([section, items]) => (
            <section key={section} className="mb-6">
              <h2 className="mb-2 px-1 text-[15px] font-semibold tracking-wide text-slate-500">
                {section}
              </h2>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {items.map((v) => (
                  <Entry
                    key={v.key}
                    entry={v.entry}
                    roleLabel={v.roleLabel}
                    open={openKeys.has(v.key)}
                    onToggle={() => toggle(v.key)}
                    device={device}
                    onZoom={(src, alt) => setZoom({ src, alt })}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {/* 關卡清單從 stepConfig 推導 —— 舊版把它寫成「六個學習步驟」並且教了兩個已停用的關卡 */}
        {!searching && role === 'student' && (
          <section className="mb-6">
            <h2 className="mb-2 px-1 text-[15px] font-semibold tracking-wide text-slate-500">
              一篇課文的關卡
            </h2>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              <p className="mb-3 text-[15px] text-slate-500">
                一般課文目前有 {activeSteps.length} 關，實際會出現哪幾關由老師的學習單決定
              </p>
              <ol className="ml-5 list-decimal space-y-1.5 text-[16px] leading-8 text-slate-700">
                {activeSteps.map((s) => <li key={s.id}>{s.label}</li>)}
              </ol>
            </div>
          </section>
        )}
      </div>

      {/* 放大檢視。點背景或按 Escape 關掉。 */}
      {zoom && (
        <div
          data-help-lightbox
          role="dialog"
          aria-modal="true"
          aria-label={zoom.alt}
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <img
            src={zoom.src}
            alt={zoom.alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg bg-white object-contain"
          />
          <button
            type="button"
            onClick={() => setZoom(null)}
            aria-label="關閉放大檢視"
            className="absolute right-5 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-[15px] text-slate-800"
          >
            關閉
          </button>
        </div>
      )}
    </div>
  );
};

export default HelpPage;
