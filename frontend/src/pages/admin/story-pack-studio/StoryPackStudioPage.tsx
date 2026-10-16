/**
 * StoryPackStudioPage（劇情包管理）— system_admin-only editor for the
 * world/story content a game mode binds to (today: 跨班賽季's storyline/
 * chest/badge content). Generalized + renamed 2026-10-16 from
 * LeagueThemeStudioPage per Young's direction.
 *
 * MVP scope (2026-10-16, Young: 「先 MVP，不要把重心放在劇情包擴展」):
 * list / edit JSON with live validation errors / pick a pack for a season
 * — deliberately NOT a richer per-field form, NOT a chapter-list UI, NOT a
 * guide-NPC editor. A JSON editor + the server's own field-level errors
 * covers it without building and maintaining bespoke UI for every nested
 * shape, for an admin-only, low-frequency tool.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import type { LeagueBoardRow } from '../../../services/leagueApi';
import type { LeagueTheme, LeagueThemeSummary } from '../../../types/leagueTheme';
import {
  AdminStoryPackApiError,
  assignSeasonPack,
  deletePack,
  fetchActivePack,
  fetchPack,
  fetchPackList,
  setActivePack,
  upsertPack,
  validatePackPayload,
} from '../../../services/adminStoryPackApi';
import BattleHero from '../../../components/league/BattleHero';

const NEW_PACK_TEMPLATE = {
  era: '',
  title: '',
  intro: [''],
  faction_labels: ['', ''],
  energy_bar_label: '',
  milestones: [{ ratio: 1.0, message: '' }],
  background_art: null,
  chest: { name: '', description: '', art: { kind: 'emoji', value: '🎁' } },
  badges: [
    { key: 'individual_badge', name: '', description: '', art: { kind: 'emoji', value: '🎖️' } },
    { key: 'class_badge', name: '', description: '', art: { kind: 'emoji', value: '🏅' } },
  ],
  result_copy: { win: '', lose: '', draw: '' },
};

/** Two fixed mock rows for the preview — this page never touches a real
 * season/board; it only needs SOME numbers to render BattleHero's layout so
 * an admin can see how their copy/art reads in context. */
const MOCK_ROWS: [LeagueBoardRow, LeagueBoardRow] = [
  {
    team_id: -1,
    classroom_id: -1,
    classroom_name: '範例班級 A',
    grade: 5,
    roster_size: 28,
    participant_count: 18,
    average_points: 84,
    team_badge_earned: false,
    treasure_chest_eligible: true,
    badge_threshold: 120,
    treasure_chest_participants_needed: 0,
    rank: 1,
  },
  {
    team_id: -2,
    classroom_id: -2,
    classroom_name: '範例班級 B',
    grade: 5,
    roster_size: 26,
    participant_count: 10,
    average_points: 52,
    team_badge_earned: false,
    treasure_chest_eligible: false,
    badge_threshold: 120,
    treasure_chest_participants_needed: 4,
    rank: 2,
  },
];

type FieldError = { loc: string; msg: string };

const StoryPackStudioPage: React.FC = () => {
  const { token } = useAuth();
  const [packs, setPacks] = useState<LeagueThemeSummary[]>([]);
  const [activeKey, setActiveKeyState] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [parsedPack, setParsedPack] = useState<LeagueTheme | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [seasonIdInput, setSeasonIdInput] = useState('');

  const loadList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [list, active] = await Promise.all([fetchPackList(token), fetchActivePack(token)]);
      setPacks(list);
      setActiveKeyState(active.key);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : '無法載入劇情包清單' });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const selectPack = useCallback(
    async (key: string) => {
      if (!token) return;
      setIsNew(false);
      setSelectedKey(key);
      setNotice(null);
      try {
        const pack = await fetchPack(token, key);
        const { key: _k, schema_version: _sv, ...rest } = pack;
        setJsonText(JSON.stringify(rest, null, 2));
      } catch (err) {
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : '無法載入劇情包內容' });
      }
    },
    [token],
  );

  const startNewPack = useCallback(() => {
    setIsNew(true);
    setSelectedKey(null);
    setNewKeyInput('');
    setNotice(null);
    setJsonText(JSON.stringify(NEW_PACK_TEMPLATE, null, 2));
  }, []);

  // Live validation — debounced so every keystroke doesn't hit the API.
  useEffect(() => {
    if (!token || !jsonText.trim()) {
      setParsedPack(null);
      setFieldErrors([]);
      setJsonParseError(null);
      return;
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(jsonText);
      setJsonParseError(null);
    } catch (err) {
      setJsonParseError(err instanceof Error ? err.message : 'JSON 格式錯誤');
      setParsedPack(null);
      return;
    }
    const key = isNew ? newKeyInput : selectedKey;
    const payload = key ? { ...raw, key } : raw;
    const timer = window.setTimeout(() => {
      validatePackPayload(token, payload)
        .then((result) => {
          setFieldErrors(result.errors);
          setParsedPack(result.valid ? ({ ...payload, schema_version: 1 } as LeagueTheme) : null);
        })
        .catch(() => {
          setFieldErrors([]);
          setParsedPack(null);
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [token, jsonText, isNew, newKeyInput, selectedKey]);

  const effectiveKey = isNew ? newKeyInput.trim() : selectedKey;
  const canSave = Boolean(effectiveKey) && parsedPack !== null && fieldErrors.length === 0;

  const handleSave = useCallback(async () => {
    if (!token || !effectiveKey) return;
    setSaving(true);
    setNotice(null);
    try {
      const raw = JSON.parse(jsonText);
      await upsertPack(token, effectiveKey, raw);
      setNotice({ kind: 'ok', text: `已儲存「${effectiveKey}」` });
      setIsNew(false);
      setSelectedKey(effectiveKey);
      await loadList();
    } catch (err) {
      if (err instanceof AdminStoryPackApiError) {
        setNotice({ kind: 'error', text: err.message });
        if (err.errors) setFieldErrors(err.errors);
      } else {
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : '儲存失敗' });
      }
    } finally {
      setSaving(false);
    }
  }, [token, effectiveKey, jsonText, loadList]);

  const handleDelete = useCallback(async () => {
    if (!token || !selectedKey) return;
    if (!window.confirm(`確定刪除劇情包「${selectedKey}」？此動作無法復原。`)) return;
    try {
      await deletePack(token, selectedKey);
      setNotice({ kind: 'ok', text: `已刪除「${selectedKey}」` });
      setSelectedKey(null);
      setJsonText('');
      await loadList();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : '刪除失敗' });
    }
  }, [token, selectedKey, loadList]);

  const handleSetActive = useCallback(async () => {
    if (!token || !selectedKey) return;
    try {
      await setActivePack(token, selectedKey);
      setActiveKeyState(selectedKey);
      setNotice({ kind: 'ok', text: `已將「${selectedKey}」設為平台預設劇情包` });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : '設定失敗' });
    }
  }, [token, selectedKey]);

  const handleAssignToSeason = useCallback(async () => {
    if (!token || !selectedKey) return;
    const seasonId = Number(seasonIdInput);
    if (!Number.isInteger(seasonId) || seasonId <= 0) {
      setNotice({ kind: 'error', text: '請輸入有效的賽季 ID' });
      return;
    }
    try {
      await assignSeasonPack(token, seasonId, selectedKey);
      setNotice({ kind: 'ok', text: `已將賽季 #${seasonId} 指派為「${selectedKey}」` });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : '指派失敗' });
    }
  }, [token, selectedKey, seasonIdInput]);

  const selectedSummary = useMemo(
    () => packs.find((p) => p.key === selectedKey) ?? null,
    [packs, selectedKey],
  );
  const isBuiltinSelected = Boolean(selectedSummary?.is_builtin);

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-0">
        <div className="p-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">劇情包庫</h2>
          <button
            type="button"
            onClick={startNewPack}
            className="text-xs px-2 py-1 rounded-md bg-accent text-white hover:opacity-90"
          >
            + 新增劇情包
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-3 text-sm text-gray-400">載入中…</p>
          ) : (
            packs.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => selectPack(p.key)}
                className={`w-full text-left px-3 py-2 border-b border-gray-50 hover:bg-gray-50 ${
                  selectedKey === p.key ? 'bg-sky-50' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{p.title || p.key}</span>
                  {p.is_builtin && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">內建</span>
                  )}
                  {activeKey === p.key && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">預設</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{p.era} · {p.key}</p>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50 min-h-0">
        {notice && (
          <div
            className={`mb-4 p-3 rounded-lg border text-sm ${
              notice.kind === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            {notice.text}
          </div>
        )}

        {!selectedKey && !isNew && (
          <p className="text-sm text-gray-500">從左側選一個劇情包，或按「+ 新增劇情包」</p>
        )}

        {(selectedKey || isNew) && (
          <div className="max-w-6xl mx-auto space-y-4">
            <header className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h1 className="text-lg font-bold text-gray-900">
                    {isNew ? '新增劇情包' : selectedKey}
                  </h1>
                  {isBuiltinSelected && (
                    <p className="text-xs text-amber-600 mt-1">內建劇情包不可覆蓋或刪除，請另存新 key</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {isNew && (
                    <input
                      type="text"
                      placeholder="劇情包 key（例：ming-voyage）"
                      value={newKeyInput}
                      onChange={(e) => setNewKeyInput(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 w-56"
                    />
                  )}
                  <button
                    type="button"
                    disabled={!canSave || saving || isBuiltinSelected}
                    onClick={handleSave}
                    className="text-sm px-3 py-1.5 rounded-lg bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                  >
                    {saving ? '儲存中…' : '儲存'}
                  </button>
                  {selectedKey && !isBuiltinSelected && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      刪除
                    </button>
                  )}
                  {selectedKey && (
                    <button
                      type="button"
                      onClick={handleSetActive}
                      disabled={activeKey === selectedKey}
                      className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40 hover:bg-gray-50"
                    >
                      設為平台預設
                    </button>
                  )}
                </div>
              </div>

              {selectedKey && (
                <>
                  <p className="mt-3 text-xs text-amber-600">
                    ⚠️「設為平台預設」目前只存在單一伺服器記憶體中（未寫入資料庫），正式站有多台伺服器時可能要等該伺服器重新啟動才會讓所有學生看到同一個預設劇情包。要讓某個賽季的劇情包立即且穩定生效，請改用下方「指派給此賽季」——那一項已完整存入資料庫。
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      placeholder="賽季 ID"
                      value={seasonIdInput}
                      onChange={(e) => setSeasonIdInput(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 w-32"
                    />
                    <button
                      type="button"
                      onClick={handleAssignToSeason}
                      className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                    >
                      指派給此賽季
                    </button>
                  </div>
                </>
              )}
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <header className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-700 flex items-center justify-between">
                  <span>劇情包內容（JSON）</span>
                  {jsonParseError ? (
                    <span className="text-xs text-red-600">JSON 格式錯誤</span>
                  ) : fieldErrors.length > 0 ? (
                    <span className="text-xs text-red-600">{fieldErrors.length} 項錯誤</span>
                  ) : parsedPack ? (
                    <span className="text-xs text-emerald-600">驗證通過</span>
                  ) : null}
                </header>
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  spellCheck={false}
                  className="w-full h-[480px] p-4 text-xs font-mono text-gray-800 outline-none resize-none"
                />
                {(jsonParseError || fieldErrors.length > 0) && (
                  <div className="p-3 border-t border-gray-100 bg-red-50/50">
                    {jsonParseError && <p className="text-xs text-red-700">{jsonParseError}</p>}
                    <ul className="text-xs text-red-700 list-disc ml-4">
                      {fieldErrors.map((e, i) => (
                        <li key={i}>
                          <code>{e.loc}</code>: {e.msg}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <header className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-700">
                  即時預覽（範例資料，非真實賽季）
                </header>
                <div className="p-4">
                  {parsedPack ? (
                    <BattleHero
                      theme={parsedPack}
                      seasonName="跨班邀請賽：範例班級 A vs 範例班級 B"
                      rows={MOCK_ROWS}
                      viewerClassroomId={-1}
                      isFinalized={false}
                    />
                  ) : (
                    <p className="text-sm text-gray-400">內容驗證通過後會顯示預覽</p>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default StoryPackStudioPage;
