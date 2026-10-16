/**
 * ClassroomPkSettingsPanel — 班級功能設定 — issue #3586 §7.4 (final revision,
 * 2026-10-16: Young "跟班級有關的都讓老師可以控制" / "default 真人 PK 是
 * disable").
 *
 * One switch today: 真人 PK（同學配對對戰 + 邀請碼），預設關閉. There is
 * deliberately no AI PK switch here — Young: "AI PK 跟班級無關", 挑戰文學家
 * is always available to every logged-in student regardless of class or
 * class settings, so there is nothing to show/toggle for it on this page.
 *
 * Self-contained: owns its own saving/error state and calls the API
 * directly on toggle (optimistic-ish — flips the switch, rolls back on
 * failure) rather than being threaded through ClassroomHeaderCard's already
 * large prop list. Mirrors how ClassroomJoinQrButton is a standalone child
 * rather than more props on the header card.
 *
 * No client-side "can this viewer edit" gate — this page's other mutating
 * actions (編輯/停用/解散) follow the same pattern: always rendered, with
 * the backend's `require_owner_or_admin` as the real authority. A
 * non-owner's click surfaces the resulting 403 as the error message below
 * rather than being hidden in advance.
 */
import React, { useState } from 'react';
import { updateClassroomPkSettings, ClassroomApiError } from '../../services/classroomApi';

interface ClassroomPkSettingsPanelProps {
  token: string;
  classroomId: number;
  pkHuman: boolean;
  onChanged: (pkHuman: boolean) => void;
}

const ClassroomPkSettingsPanel: React.FC<ClassroomPkSettingsPanelProps> = ({
  token,
  classroomId,
  pkHuman,
  onChanged,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleToggle = async () => {
    if (isSaving) return;
    const next = !pkHuman;
    setError('');
    setIsSaving(true);
    try {
      const result = await updateClassroomPkSettings(token, classroomId, next);
      onChanged(result.pk_human);
    } catch (err) {
      setError(err instanceof ClassroomApiError ? err.message : '更新失敗，請稍後再試');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5" aria-label="班級功能設定">
      <h3 className="text-sm font-bold text-gray-900 mb-3">班級功能設定</h3>

      <div className="flex items-start justify-between gap-4 py-2">
        <div>
          <p className="text-sm font-medium text-gray-900">真人 PK</p>
          <p className="text-xs text-gray-500 mt-0.5">同學之間配對對戰，預設關閉</p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={pkHuman}
          aria-label="真人 PK 開關"
          disabled={isSaving}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
            pkHuman ? 'bg-emerald-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              pkHuman ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
};

export default ClassroomPkSettingsPanel;
