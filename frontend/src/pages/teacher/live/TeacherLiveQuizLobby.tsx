/**
 * TeacherLiveQuizLobby — 等待室: 大字 6 碼 + QR + 已加入名單.
 * PRD §12: 老師可把人移出等待室；投影的在線人數只算最近 10 秒有回應的人。
 */
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QR_ENTRY_ORIGIN } from '../../../components/qr/lessonQr';
import { removeLiveQuizPlayer } from '../../../services/liveQuizApi';
import type { LiveQuizHostPlayer, LiveQuizState } from '../../../services/liveQuizApi';

interface Props {
  state: LiveQuizState;
  token: string;
  code: string;
  onStart: () => void;
  starting: boolean;
}

const TeacherLiveQuizLobby: React.FC<Props> = ({ state, token, code, onStart, starting }) => {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(`${QR_ENTRY_ORIGIN}/live/${code}`, { errorCorrectionLevel: 'M', margin: 2, width: 420 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [code]);

  const players: LiveQuizHostPlayer[] = state.players ?? [];

  const handleRemove = async (playerId: number) => {
    try {
      await removeLiveQuizPlayer(token, code, playerId);
    } catch {
      /* best-effort — the roster will just show them again on the next poll */
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10 text-center">
      <p className="mb-2 text-lg text-on-surface-variant">學生用手機掃描或輸入代碼加入</p>
      <p
        className="mb-6 font-mono font-bold tracking-[0.3em] text-accent"
        style={{ fontSize: 'clamp(56px, 10vw, 112px)' }}
      >
        {code}
      </p>
      {qrDataUrl && <img src={qrDataUrl} alt="加入課堂搶答 QR code" className="mb-8 h-64 w-64 sm:h-80 sm:w-80" />}

      <div className="mb-8 w-full max-w-2xl">
        <p className="mb-3 text-sm font-medium text-on-surface-variant">
          已加入 {players.length} 人 · 在線 {state.online_count ?? 0} 人
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {players.map((p) => (
            <span
              key={p.player_id}
              className="group relative inline-flex items-center gap-1.5 rounded-full bg-surface-container px-4 py-2 text-sm"
            >
              <span className={`h-2 w-2 rounded-full ${p.online ? 'bg-[#15803D]' : 'bg-surface-dim'}`} aria-hidden="true" />
              {p.display_name}
              <button
                type="button"
                onClick={() => void handleRemove(p.player_id)}
                aria-label={`移除 ${p.display_name}`}
                className="ml-1 text-on-surface-variant hover:text-error"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={starting || players.length === 0}
        className="rounded-xl bg-accent px-10 py-4 text-xl font-semibold text-white shadow-md transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {starting ? '開始中…' : '開始搶答'}
      </button>
      {players.length === 0 && <p className="mt-3 text-sm text-on-surface-variant">至少要有一人加入才能開始</p>}
    </div>
  );
};

export default TeacherLiveQuizLobby;
