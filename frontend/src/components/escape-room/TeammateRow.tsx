import React from 'react';
import type { EscapeRoomTeammate } from '../../services/escapeRoomApi';

interface TeammateRowProps {
  teammates: EscapeRoomTeammate[];
}

const TEAMMATE_NAMES: Record<string, string> = {
  bookworm: '小書',
  lantern: '小頁',
  compass: '小字',
};

const TeammateRow: React.FC<TeammateRowProps> = ({ teammates }) => (
  <section aria-label="隊友狀態" className="flex items-center justify-center gap-2 sm:gap-3">
    {teammates.map((teammate, index) => (
      <div
        key={teammate.slug}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border p-2 text-left sm:p-3 ${
          teammate.frozen ? 'border-slate-300 bg-slate-100/80 opacity-60' : 'border-accent-bg-subtle bg-white'
        }`}
        aria-label={`${TEAMMATE_NAMES[teammate.slug] ?? '隊友'}${teammate.frozen ? '，暫時被定住' : '，在隊伍中'}`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-bg text-sm sm:h-10 sm:w-10 ${
            teammate.frozen ? 'ring-2 ring-slate-300' : ''
          }`}
          aria-hidden="true"
        >
          {['書', '頁', '字'][index % 3]}
        </span>
        <span className="min-w-0 text-xs font-medium text-on-surface sm:text-sm">
          <span className="block truncate">{TEAMMATE_NAMES[teammate.slug] ?? '隊友'}</span>
          <span className="hidden text-on-surface-variant sm:block">{teammate.frozen ? '暫時定住' : '一起前進'}</span>
        </span>
      </div>
    ))}
  </section>
);

export default TeammateRow;
