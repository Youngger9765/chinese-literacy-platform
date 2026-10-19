/**
 * ClassroomPkSettingsPanel — 班級功能設定 — issue #3586 §7.4 (final revision,
 * 2026-10-16: Young "跟班級有關的都讓老師可以控制" / "default 真人 PK 是
 * disable"), extended by issue #3607 (2026-10-17, Young: "班級的 跨班賽季
 * ＋劇情包、班級內 PK、課堂搶答 都是 default off，要老師啟動才能用").
 *
 * Three switches today: 真人 PK（同學配對對戰）、跨班賽季（劇情包）、課堂
 * 搶答 — each default OFF, each independently toggleable. There is
 * deliberately no AI PK switch here — Young: "AI PK 跟班級無關", 挑戰文學家
 * is always available to every logged-in student regardless of class or
 * class settings, so there is nothing to show/toggle for it on this page.
 *
 * Self-contained: owns its own saving/error state and calls the API
 * directly on toggle (optimistic-ish — flips the switch, rolls back on
 * failure) rather than being threaded through ClassroomHeaderCard's already
 * large prop list. Mirrors how ClassroomJoinQrButton is a standalone child
 * rather than more props on the header card. Each switch's PATCH call only
 * names its own key (`updateClassroomFeatureSettings` merges server-side),
 * so toggling one switch can never race-clobber another mid-flight.
 *
 * No client-side "can this viewer edit" gate — this page's other mutating
 * actions (編輯/停用/解散) follow the same pattern: always rendered, with
 * the backend's `require_owner_or_admin` as the real authority. A
 * non-owner's click surfaces the resulting 403 as the error message below
 * rather than being hidden in advance.
 */
import React, { useState } from 'react';
import { updateClassroomFeatureSettings, ClassroomApiError } from '../../services/classroomApi';

type FeatureKey = 'pk_human' | 'league' | 'live_quiz' | 'team_arena';

interface ClassroomPkSettingsPanelProps {
  token: string;
  classroomId: number;
  pkHuman: boolean;
  league: boolean;
  liveQuiz: boolean;
  /** Issue #3632 — 五人對抗賽班級開關. Optional (default false) so existing
   * callers/tests that predate this field keep compiling unchanged. */
  teamArena?: boolean;
  onChanged: (next: {
    pk_human: boolean;
    league: boolean;
    live_quiz: boolean;
    team_arena?: boolean;
  }) => void;
}

const SWITCHES: { key: FeatureKey; title: string; description: string; ariaLabel: string }[] = [
  { key: 'pk_human', title: '真人 PK', description: '同學之間配對對戰，預設關閉', ariaLabel: '真人 PK 開關' },
  { key: 'league', title: '跨班賽季', description: '跟其他班一起比幾週，附故事劇情包，預設關閉', ariaLabel: '跨班賽季開關' },
  { key: 'live_quiz', title: '課堂搶答', description: '現在全班一起即時搶答，約 10 分鐘，預設關閉', ariaLabel: '課堂搶答開關' },
  { key: 'team_arena', title: '五人對抗賽', description: '五人一組，組隊競賽，預設關閉', ariaLabel: '五人對抗賽開關' },
];

const ClassroomPkSettingsPanel: React.FC<ClassroomPkSettingsPanelProps> = ({
  token,
  classroomId,
  pkHuman,
  league,
  liveQuiz,
  teamArena = false,
  onChanged,
}) => {
  const [savingKey, setSavingKey] = useState<FeatureKey | null>(null);
  const [error, setError] = useState('');

  const currentValue: Record<FeatureKey, boolean> = {
    pk_human: pkHuman,
    league,
    live_quiz: liveQuiz,
    team_arena: teamArena,
  };

  const handleToggle = async (key: FeatureKey) => {
    if (savingKey) return;
    const next = !currentValue[key];
    setError('');
    setSavingKey(key);
    try {
      const result = await updateClassroomFeatureSettings(token, classroomId, { [key]: next });
      onChanged(result);
    } catch (err) {
      setError(err instanceof ClassroomApiError ? err.message : '更新失敗，請稍後再試');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5" aria-label="班級功能設定">
      <h3 className="text-sm font-bold text-gray-900 mb-3">班級功能設定</h3>

      <div className="divide-y divide-gray-100">
        {SWITCHES.map(({ key, title, description, ariaLabel }) => {
          const checked = currentValue[key];
          return (
            <div key={key} className="flex items-start justify-between gap-4 py-2">
              <div>
                <p className="text-sm font-medium text-gray-900">{title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={ariaLabel}
                disabled={savingKey !== null}
                onClick={() => handleToggle(key)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                  checked ? 'bg-emerald-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    checked ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
};

export default ClassroomPkSettingsPanel;
