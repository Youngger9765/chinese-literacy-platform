/**
 * 加學生 —— 照均一的模式 (#3378)
 *
 * 老師只回答一個問題：「學生有沒有帳號？」
 *   - 沒有帳號：貼上名單（或只填人數）→ 系統產生帳號密碼 → 列印帳密卡發給學生
 *   - 已有帳號：給學生班級代碼，或輸入學生編號
 * 原本「直接產生帳密」只在管理員後台，老師只能先準備 CSV 檔。
 */
import React, { useState } from 'react';
import { BatchCreateResult, batchCreateStudents, ClassroomApiError } from '../../../services/classroomApi';
import { openCredentialCards } from './credentialCards';

type Mode = 'no-account' | 'has-account';

export interface ParsedStudent {
  name: string;
  seat_number: string;
}

/**
 * One student per line: 「王小明」 or 「3 王小明」 / 「3,王小明」.
 * A bare number means "this many students" and fills 1號…N號.
 * Seats without a number continue after the highest seat already used.
 */
export function parseRoster(text: string, firstSeat = 1): ParsedStudent[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && /^\d{1,3}$/.test(lines[0])) {
    const n = Math.min(Number(lines[0]), 60);
    return Array.from({ length: n }, (_, i) => ({ name: `${firstSeat + i} 號`, seat_number: String(firstSeat + i) }));
  }
  let next = firstSeat;
  return lines.map((line) => {
    const m = line.match(/^(\d{1,3})[\s,，、.]+(.+)$/);
    if (m) {
      next = Math.max(next, Number(m[1]) + 1);
      return { name: m[2].trim(), seat_number: m[1] };
    }
    return { name: line, seat_number: String(next++) };
  });
}

interface AddStudentsPanelProps {
  token: string;
  classroomId: number;
  classroomName: string;
  joinCode: string | null | undefined;
  /** Highest seat number already in the class, so new seats don't collide. */
  nextSeat: number;
  onCreated: () => void;
  /** The existing "add by student ID" form, shown under 已有帳號. */
  addByIdForm: React.ReactNode;
  onOpenCsv: () => void;
}

const AddStudentsPanel: React.FC<AddStudentsPanelProps> = ({
  token,
  classroomId,
  classroomName,
  joinCode,
  nextSeat,
  onCreated,
  addByIdForm,
  onOpenCsv,
}) => {
  const [mode, setMode] = useState<Mode>('no-account');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BatchCreateResult | null>(null);

  const parsed = parseRoster(text, nextSeat);

  const create = async () => {
    if (parsed.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const r = await batchCreateStudents(token, classroomId, parsed);
      setResult(r);
      setText('');
      onCreated();
    } catch (e) {
      setError(e instanceof ClassroomApiError ? e.message : '建立帳號失敗，請再試一次');
    } finally {
      setBusy(false);
    }
  };

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => setMode(m)}
      className={`flex-1 px-3 py-2.5 rounded-lg text-base font-medium cursor-pointer ${
        mode === m ? 'bg-white shadow text-accent' : 'text-gray-600'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-5 border-b border-gray-100 space-y-4">
      <div>
        <p className="font-semibold text-gray-900 mb-2">加學生：學生有沒有帳號？</p>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="學生有沒有帳號">
          {tab('no-account', '還沒有帳號')}
          {tab('has-account', '已經有帳號')}
        </div>
      </div>

      {mode === 'no-account' && (
        <div className="space-y-3">
          <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            學生用均一帳號登入的話，請改選「已經有帳號」，讓學生用均一登入後輸入班級代碼，才不會多出一組重複的帳號
          </p>
          <label htmlFor="roster-input" className="block text-sm text-gray-700">
            一行一位學生，可以寫「座號 姓名」或只寫姓名；也可以只填人數（例如 28）
          </label>
          <textarea
            id="roster-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={'1 王小明\n2 林雨萱\n3 陳柏宇'}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={create}
              disabled={busy || parsed.length === 0}
              className="h-11 px-5 rounded-lg bg-accent text-white font-semibold disabled:opacity-50 cursor-pointer"
            >
              {busy ? '建立中…' : `建立 ${parsed.length} 個學生帳號`}
            </button>
            <button type="button" onClick={onOpenCsv} className="text-sm text-gray-500 underline cursor-pointer">
              或上傳 CSV 檔
            </button>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          {result && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
              <p className="font-semibold text-green-800">已建立 {result.created.length} 個帳號</p>
              {result.errors.length > 0 && (
                <p className="text-sm text-red-700">有 {result.errors.length} 位沒有建立成功（多半是座號重複），請改座號再試</p>
              )}
              {result.created.length > 0 && (
                <button
                  type="button"
                  onClick={() => openCredentialCards(classroomName, result.created)}
                  className="h-11 px-5 rounded-lg bg-white border border-accent text-accent font-semibold cursor-pointer"
                >
                  列印帳密卡
                </button>
              )}
              <p className="text-sm text-gray-600">帳號密碼只會顯示這一次，請先列印或抄下來</p>
            </div>
          )}
        </div>
      )}

      {mode === 'has-account' && (
        <div className="space-y-3">
          {joinCode && (
            <p className="text-gray-700">
              請學生登入（可用均一帳號）後輸入班級代碼{' '}
              <span className="font-mono text-2xl font-bold tracking-widest text-accent align-middle">{joinCode}</span>
            </p>
          )}
          <div>
            <p className="text-sm text-gray-500 mb-1">或輸入學生編號直接加入</p>
            {addByIdForm}
          </div>
        </div>
      )}
    </div>
  );
};

export default AddStudentsPanel;
