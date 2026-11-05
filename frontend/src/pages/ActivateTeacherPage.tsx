import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import {
  activateTeacher,
  searchSchoolDirectory,
  AuthError,
  type ActivateTeacherSchoolInput,
  type SchoolDirectoryItem,
  type SchoolNameSuggestion,
} from '../services/authApi';

/**
 * ActivateTeacherPage — self-serve "開通老師身分" (#3804, extended #3812 §4.4).
 *
 * Young 2026-11-01 (second + third instructions): any student can self-
 * activate as a teacher by naming the school(s) they teach at. No approval.
 * Young 2026-11-02 (#3812): once the MOE school directory existed, the
 * plain free-text input must become "縣市 → 搜尋 → 選一筆" so activation
 * binds by `moe_school_code` instead of comparing school names (a typo
 * comparing names is how one real school gets split into two rows).
 *
 * Design: docs/prd/2026-11-01-school-as-teacher-attribute-prd.md §10 (original)
 * + §4.4 (directory search + manual-entry pending_review, #3812).
 *
 * Entry point: student sidebar, right after "加入班級" (§10.1).
 * Route: /activate-teacher (independent page, not a modal — §10.2).
 */

const MAX_SCHOOLS = 5; // frontend-only soft cap; backend allows up to 10

const SEARCH_DEBOUNCE_MS = 300;

// 22 counties/cities, in the "台" (not "臺") normalized form the MOE
// directory data was imported with (see backend/data/moe_schools/README.md
// and school_directory_search.py::normalize_school_name). A constant list
// is fine here (PRD §4.4): these don't change, and it avoids a round trip
// just to populate a dropdown.
const COUNTIES = [
  '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
  '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
  '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
  '台東縣', '澎湖縣', '金門縣', '連江縣',
];

interface DirectorySelection {
  moe_school_code: string;
  name: string;
}

interface SchoolRow {
  mode: 'directory' | 'manual';
  county: string;
  query: string;
  selected: DirectorySelection | null;
  manualName: string;
  results: SchoolDirectoryItem[];
  suggestions: SchoolNameSuggestion[] | null;
}

function emptyRow(): SchoolRow {
  return {
    mode: 'directory',
    county: '',
    query: '',
    selected: null,
    manualName: '',
    results: [],
    suggestions: null,
  };
}

const ActivateTeacherPage: React.FC = () => {
  const navigate = useNavigate();
  const { token, refreshUser } = useAuth();
  const { setActiveView } = useWorkspace();

  const [rows, setRows] = useState<SchoolRow[]>([emptyRow()]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successSchools, setSuccessSchools] = useState<
    { name: string; role_active: boolean }[] | null
  >(null);

  const debounceTimers = useRef<Array<ReturnType<typeof setTimeout> | null>>([null]);
  const searchSeq = useRef<number[]>([0]);

  const updateRow = (index: number, patch: Partial<SchoolRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setError('');
  };

  const runSearch = useCallback(
    async (index: number, county: string, q: string) => {
      if (!token || (!county && !q.trim())) {
        updateRow(index, { results: [], suggestions: null });
        return;
      }
      const seq = (searchSeq.current[index] = (searchSeq.current[index] ?? 0) + 1);
      try {
        const res = await searchSchoolDirectory(token, county, q.trim());
        // stale-response guard -- ignore if a newer search for this row started
        if (searchSeq.current[index] !== seq) return;
        updateRow(index, { results: res.items, suggestions: res.suggestions });
      } catch {
        if (searchSeq.current[index] !== seq) return;
        updateRow(index, { results: [], suggestions: null });
      }
    },
    [token],
  );

  const handleCountyChange = (index: number, county: string) => {
    updateRow(index, { county, selected: null });
    const row = rows[index];
    if (debounceTimers.current[index]) clearTimeout(debounceTimers.current[index]!);
    debounceTimers.current[index] = setTimeout(() => runSearch(index, county, row.query), SEARCH_DEBOUNCE_MS);
  };

  const handleQueryChange = (index: number, query: string) => {
    updateRow(index, { query, selected: null });
    if (debounceTimers.current[index]) clearTimeout(debounceTimers.current[index]!);
    debounceTimers.current[index] = setTimeout(() => {
      runSearch(index, rows[index].county, query);
    }, SEARCH_DEBOUNCE_MS);
  };

  const selectResult = (index: number, item: SchoolDirectoryItem) => {
    updateRow(index, {
      selected: { moe_school_code: item.moe_school_code, name: item.name },
      results: [],
      suggestions: null,
    });
  };

  const clickSuggestion = (index: number, suggestion: SchoolNameSuggestion) => {
    updateRow(index, { query: suggestion.school_name, suggestions: null });
    if (debounceTimers.current[index]) clearTimeout(debounceTimers.current[index]!);
    debounceTimers.current[index] = setTimeout(() => {
      runSearch(index, rows[index].county, suggestion.school_name);
    }, SEARCH_DEBOUNCE_MS);
  };

  const switchToManual = (index: number) => {
    updateRow(index, { mode: 'manual', selected: null, results: [], suggestions: null, query: '' });
  };

  const changeSelection = (index: number) => {
    updateRow(index, { selected: null });
  };

  const addSchoolField = () => {
    if (rows.length >= MAX_SCHOOLS) return;
    debounceTimers.current.push(null);
    searchSeq.current.push(0);
    setRows((prev) => [...prev, emptyRow()]);
  };

  const removeSchoolField = (index: number) => {
    if (rows.length <= 1) return;
    if (debounceTimers.current[index]) clearTimeout(debounceTimers.current[index]!);
    debounceTimers.current.splice(index, 1);
    searchSeq.current.splice(index, 1);
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      timers.forEach((t) => t && clearTimeout(t));
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload: ActivateTeacherSchoolInput[] = [];
    for (const row of rows) {
      if (row.mode === 'directory' && row.selected) {
        payload.push({ moe_school_code: row.selected.moe_school_code });
      } else if (row.mode === 'manual' && row.manualName.trim()) {
        payload.push({ name: row.manualName.trim() });
      }
    }

    if (payload.length === 0) {
      setError('請至少選擇一所學校');
      return;
    }
    if (!token) {
      setError('請先登入');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const result = await activateTeacher(token, payload);
      await refreshUser();
      setSuccessSchools(
        result.schools.map((s) => ({ name: s.name, role_active: s.role_active }))
      );
      setActiveView('teacher');
      // Claude Security find_01RzZ2bXyjs6SrNmD7KkKy91 (high), 2026-11-05:
      // only auto-navigate to the teacher dashboard when at least one
      // school is actually usable (role_active). A fully-pending result
      // (every school still awaiting admin confirmation) stays on this
      // screen so the "等待學校管理員確認" message is the thing the
      // teacher sees next, not a confusing 403 on teacher-home.
      if (result.schools.some((s) => s.role_active)) {
        setTimeout(() => navigate('/teacher-home'), 1500);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        setError(err.message || '開通失敗，請稍後再試');
      } else {
        setError('開通失敗，請檢查網路連線後再試一次');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successSchools) {
    const activeSchools = successSchools.filter((s) => s.role_active);
    const pendingSchools = successSchools.filter((s) => !s.role_active);
    const anyActive = activeSchools.length > 0;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4 text-3xl">
            {anyActive ? '🎉' : '⏳'}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {anyActive ? '開通成功！' : '已送出開通申請'}
          </h1>
          <p className="text-gray-500 text-sm mt-2">
            {anyActive ? '你現在也是老師了' : '等待學校管理員確認'}
          </p>
          {activeSchools.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 mt-6 text-sm text-gray-700">
              {activeSchools.map((s) => s.name).join('、')}
            </div>
          )}
          {/* Claude Security find_01RzZ2bXyjs6SrNmD7KkKy91 (high), 2026-11-05:
              a genuinely pre-existing (MOE-imported/admin-created) school
              grants the role inactive, pending a system_admin's
              confirmation. The teacher must see THIS, not a silent
              "success" followed by a confusing 403 the next time they try
              to create a classroom or see a student. */}
          {pendingSchools.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mt-4 text-sm text-amber-800 text-left">
              <p className="font-medium mb-1">
                以下學校已經存在資料，需要學校管理員確認您的身分後才能使用：
              </p>
              <p>{pendingSchools.map((s) => s.name).join('、')}</p>
              <p className="text-xs text-amber-700 mt-2">
                請聯繫學校管理員協助確認，確認後即可建立班級與查看學生。
              </p>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-4">
            {anyActive ? '正在前往老師首頁...' : '您可以先返回首頁，確認後再回來使用老師功能。'}
          </p>
          {!anyActive && (
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-4 text-sm text-accent underline"
            >
              返回首頁
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4 text-3xl">
            🏫
          </div>
          <h1 className="text-2xl font-bold text-gray-900">開通老師身分</h1>
          <p className="text-gray-500 text-sm mt-2">
            選擇你任教的學校，開通後就能建立班級、指派作業。可以填多所學校。
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5"
        >
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {rows.map((row, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">學校 {index + 1}</label>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSchoolField(index)}
                    aria-label={`移除學校 ${index + 1}`}
                    className="px-2 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>

              {row.mode === 'manual' ? (
                <input
                  id={`school-${index}-manual`}
                  aria-label={`學校 ${index + 1} 名稱（手動輸入）`}
                  type="text"
                  value={row.manualName}
                  onChange={(e) => updateRow(index, { manualName: e.target.value })}
                  placeholder="請輸入完整校名"
                  autoComplete="off"
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
              ) : row.selected ? (
                <div className="flex items-center justify-between h-11 px-3 rounded-lg border border-accent bg-accent/5 text-sm">
                  <span className="text-gray-900 font-medium">{row.selected.name}</span>
                  <button
                    type="button"
                    onClick={() => changeSelection(index)}
                    className="text-accent hover:text-accent-hover text-xs font-medium"
                  >
                    更改
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <select
                    id={`school-${index}-county`}
                    aria-label={`學校 ${index + 1} 縣市`}
                    value={row.county}
                    onChange={(e) => handleCountyChange(index, e.target.value)}
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  >
                    <option value="">請選擇縣市</option>
                    {COUNTIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>

                  <div className="relative">
                    <input
                      id={`school-${index}-query`}
                      aria-label={`學校 ${index + 1} 名稱搜尋`}
                      type="text"
                      value={row.query}
                      onChange={(e) => handleQueryChange(index, e.target.value)}
                      placeholder="輸入學校名稱搜尋，例如：大安國小"
                      autoComplete="off"
                      className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                    />

                    {row.results.length > 0 && (
                      <ul
                        role="listbox"
                        aria-label={`學校 ${index + 1} 搜尋結果`}
                        className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto"
                      >
                        {row.results.map((item) => (
                          <li key={item.moe_school_code}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={false}
                              onClick={() => selectResult(index, item)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-accent/10 transition-colors"
                            >
                              <span className="text-gray-900">{item.name}</span>
                              {item.county_name && (
                                <span className="text-gray-400 ml-2 text-xs">{item.county_name}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {row.results.length === 0 &&
                      row.suggestions !== null &&
                      row.suggestions.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full bg-amber-50 border border-amber-200 rounded-lg shadow-lg px-3 py-2">
                          <p className="text-xs text-amber-700 mb-1">您是不是要找：</p>
                          <div className="flex flex-wrap gap-2">
                            {row.suggestions.map((s) => (
                              <button
                                key={s.school_name}
                                type="button"
                                onClick={() => clickSuggestion(index, s)}
                                className="px-2 py-1 text-xs rounded-full bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
                              >
                                {s.school_name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {row.mode === 'directory' && !row.selected && (
                <button
                  type="button"
                  onClick={() => switchToManual(index)}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  找不到我的學校
                </button>
              )}
            </div>
          ))}

          {rows.length < MAX_SCHOOLS && (
            <button
              type="button"
              onClick={addSchoolField}
              className="text-sm text-accent hover:text-accent-hover font-medium transition-colors"
            >
              + 再加一所學校
            </button>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
          >
            {isSubmitting ? '開通中...' : '開通老師身分'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-accent hover:text-accent-hover font-medium transition-colors"
          >
            返回首頁
          </button>
        </p>
      </div>
    </div>
  );
};

export default ActivateTeacherPage;
