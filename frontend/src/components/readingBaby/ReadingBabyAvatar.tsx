/**
 * ReadingBabyAvatar — 用 SVG 畫出閱讀寶貝（#3780 第三階段）。
 *
 * 外觀由 `readingBabyAppearance.ts` 的公式決定（劇情類型 × 年級 × 招牌小物 × 花紋），
 * 三階差異沿用 island-v2 design §3.5：
 *   - 基礎：體型最小、造型最簡化（只有身體、臉、胸前一枚小徽章）
 *   - 中階：長大一點，手上拿著招牌小物
 *   - 進階：完整造型——小物＋劇情道具＋發光
 * 還沒遇見：灰色剪影，沒有臉。
 *
 * 兒童情緒安全（game-design §1.3）：魔王劇情的寶貝也是友善造型，不畫成敵人。
 */
import React, { useId } from 'react';
import type { ReadingBabyStage } from '../../services/readingBabyApi';
import { appearanceFor, type AccessoryIcon, type GradePalette, type Pattern } from './readingBabyAppearance';
import type { StoryType } from '../../pages/lab/island/islandTemplate';

export const STAGE_NAME: Record<ReadingBabyStage, string> = {
  not_encountered: '還沒遇見',
  basic: '基礎',
  intermediate: '中階',
  advanced: '進階',
};

const STAGE_SCALE: Record<Exclude<ReadingBabyStage, 'not_encountered'>, number> = {
  basic: 0.74,
  intermediate: 0.88,
  advanced: 1,
};

function BodyShape({ type, fill, stroke }: { type: StoryType; fill: string; stroke: string }) {
  const common = { fill, stroke, strokeWidth: 2.5, strokeLinejoin: 'round' as const };
  switch (type) {
    case 'repair':
      return (
        <g>
          <circle cx="36" cy="40" r="9" {...common} />
          <circle cx="84" cy="40" r="9" {...common} />
          <rect x="24" y="38" width="72" height="66" rx="26" {...common} />
        </g>
      );
    case 'boss':
      return (
        <path
          d="M30 102 C16 102 14 82 27 77 C21 59 40 48 50 57 C53 40 77 38 80 55 C92 46 108 60 98 76 C110 82 104 104 90 102 Z"
          {...common}
        />
      );
    case 'treasure':
      return <path d="M60 32 C84 32 98 62 98 80 C98 98 82 106 60 106 C38 106 22 98 22 80 C22 62 36 32 60 32 Z" {...common} />;
    case 'detective':
      return (
        <g>
          <path d="M34 50 L30 26 L50 40 Z" {...common} />
          <path d="M86 50 L90 26 L70 40 Z" {...common} />
          <ellipse cx="60" cy="72" rx="34" ry="36" {...common} />
        </g>
      );
    case 'competition':
    default:
      return (
        <g>
          <ellipse cx="44" cy="104" rx="10" ry="5" {...common} />
          <ellipse cx="76" cy="104" rx="10" ry="5" {...common} />
          <ellipse cx="60" cy="72" rx="38" ry="33" {...common} />
        </g>
      );
  }
}

function PatternMarks({ pattern, color }: { pattern: Pattern; color: string }) {
  const o = { fill: color, opacity: 0.55 };
  switch (pattern) {
    case 'spots':
      return (
        <g data-pattern="spots">
          <circle cx="38" cy="62" r="4" {...o} /><circle cx="84" cy="66" r="3.5" {...o} /><circle cx="42" cy="78" r="2.5" {...o} />
        </g>
      );
    case 'stripes':
      return (
        <g data-pattern="stripes" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.5">
          <path d="M50 44 L52 52" /><path d="M60 42 L60 51" /><path d="M70 44 L68 52" />
        </g>
      );
    case 'freckles':
      return (
        <g data-pattern="freckles">
          <circle cx="44" cy="74" r="1.6" {...o} /><circle cx="48" cy="77" r="1.6" {...o} />
          <circle cx="76" cy="74" r="1.6" {...o} /><circle cx="72" cy="77" r="1.6" {...o} />
        </g>
      );
    case 'heart':
      return <path data-pattern="heart" d="M84 60 c-3-4-9-1-6 4 l6 6 6-6 c3-5-3-8-6-4z" {...o} />;
    case 'star':
      return <path data-pattern="star" d="M38 58 l2 4 4.5 .6 -3.3 3 .8 4.4 -4-2.2 -4 2.2 .8-4.4 -3.3-3 4.5-.6z" {...o} />;
    case 'leaf':
      return <path data-pattern="leaf" d="M58 40 C66 36 72 40 70 46 C64 48 58 46 58 40 Z" {...o} />;
    case 'moon':
      return <path data-pattern="moon" d="M86 56 a7 7 0 1 0 0 12 a5 5 0 1 1 0 -12z" {...o} />;
    default:
      return null;
  }
}

/** 招牌小物圖示，畫在 24×24 的方格裡。 */
function AccessoryGlyph({ icon, accent, outline }: { icon: AccessoryIcon; accent: string; outline: string }) {
  const s = { stroke: outline, strokeWidth: 1.8, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const f = { ...s, fill: accent };
  const w = { ...s, fill: '#FFFFFF' };
  switch (icon) {
    case 'funnel': return <path d="M3 5 H21 L14 13 V20 L10 22 V13 Z" {...f} />;
    case 'scroll': return <g><rect x="5" y="4" width="14" height="16" rx="2" {...w} /><path d="M8 9 H16 M8 13 H16 M8 17 H13" {...s} /><rect x="3" y="2" width="18" height="4" rx="2" {...f} /></g>;
    case 'magnifier': return <g><circle cx="10" cy="10" r="6.5" {...w} /><path d="M15 15 L21 21" {...s} strokeWidth={3.2} stroke={accent} /></g>;
    case 'lightbulb': return <g><path d="M12 2 C6.5 2 4.5 8 7.5 12 C9 14 9 15 9 17 H15 C15 15 15 14 16.5 12 C19.5 8 17.5 2 12 2 Z" {...f} /><rect x="9" y="18" width="6" height="3.5" rx="1" {...w} /></g>;
    case 'question': return <g><circle cx="12" cy="12" r="10" {...f} /><path d="M9 9 C9 5.5 15 5.5 15 9 C15 11.5 12 11.5 12 14" {...s} stroke="#fff" strokeWidth={2.4} /><circle cx="12" cy="17.6" r="1.4" fill="#fff" /></g>;
    case 'chart': return <g><rect x="2" y="2" width="20" height="20" rx="3" {...w} /><rect x="6" y="12" width="3" height="7" fill={accent} /><rect x="11" y="8" width="3" height="11" fill={accent} /><rect x="16" y="5" width="3" height="14" fill={accent} /></g>;
    case 'map': return <g><path d="M2 5 L8 3 L16 6 L22 4 V19 L16 21 L8 18 L2 20 Z" {...w} /><path d="M8 3 V18 M16 6 V21" {...s} /><circle cx="12" cy="11" r="2" fill={accent} /></g>;
    case 'compass': return <g><circle cx="12" cy="12" r="10" {...w} /><path d="M12 4 L15 12 L12 20 L9 12 Z" {...f} /></g>;
    case 'bookmark': return <path d="M6 2 H18 V22 L12 17 L6 22 Z" {...f} />;
    case 'key': return <g><circle cx="7" cy="12" r="5" {...f} /><path d="M12 12 H22 M18 12 V16 M21 12 V15" {...s} strokeWidth={2.4} /></g>;
    case 'puzzle': return <path d="M3 8 H8 C8 4 13 4 13 8 H18 V13 C22 13 22 18 18 18 V22 H3 Z" {...f} />;
    case 'pen': return <g><path d="M4 20 L6 14 L17 3 L21 7 L10 18 Z" {...f} /><path d="M4 20 L6 14 L10 18 Z" {...w} /></g>;
    case 'flask': return <g><path d="M9 2 H15 M10 2 V9 L4 20 C3.5 21 4 22 5 22 H19 C20 22 20.5 21 20 20 L14 9 V2" {...w} /><path d="M6.5 16 H17.5 L19.5 20.5 H4.5 Z" fill={accent} /></g>;
    case 'tablet': return <g><rect x="4" y="2" width="16" height="20" rx="3" {...f} /><rect x="6.5" y="5" width="11" height="12" rx="1" fill="#fff" /><circle cx="12" cy="19.5" r="1" fill="#fff" /></g>;
    case 'books': return <g><rect x="3" y="4" width="5" height="17" rx="1" {...f} /><rect x="9" y="6" width="5" height="15" rx="1" {...w} /><rect x="15" y="3" width="6" height="18" rx="1" {...f} /></g>;
    case 'heart': return <path d="M12 21 C3 14 1 9 4.5 5.5 C7.5 2.5 11 4 12 7 C13 4 16.5 2.5 19.5 5.5 C23 9 21 14 12 21 Z" {...f} />;
    case 'brush': return <g><rect x="10.5" y="2" width="3" height="12" rx="1.2" {...w} /><path d="M9 14 H15 L14 20 C13 22.5 11 22.5 10 20 Z" {...f} /></g>;
    case 'star': return <path d="M12 2 L14.9 8.4 L22 9.2 L16.7 14 L18.2 21 L12 17.4 L5.8 21 L7.3 14 L2 9.2 L9.1 8.4 Z" {...f} />;
    case 'book':
    default:
      return <g><path d="M2 5 C6 3 10 4 12 6 C14 4 18 3 22 5 V20 C18 18 14 19 12 21 C10 19 6 18 2 20 Z" {...w} /><path d="M12 6 V21" {...s} /><path d="M5 9 H9 M15 9 H19" stroke={accent} strokeWidth="1.8" strokeLinecap="round" /></g>;
  }
}

function StoryProp({ type, palette }: { type: StoryType; palette: GradePalette }) {
  const s = { stroke: palette.outline, strokeWidth: 2, strokeLinejoin: 'round' as const };
  switch (type) {
    case 'repair': // 修復：頭上一顆小齒輪
      return (
        <g data-part="story-prop" transform="translate(60 26)">
          <path d="M0 -11 L3 -7 L8 -8 L7 -3 L11 0 L7 3 L8 8 L3 7 L0 11 L-3 7 L-8 8 L-7 3 L-11 0 L-7 -3 L-8 -8 L-3 -7 Z" fill={palette.accent} {...s} />
          <circle r="3.5" fill="#fff" {...s} />
        </g>
      );
    case 'boss': // 化解心結：頭上一顆會發光的小光球
      return (
        <g data-part="story-prop">
          <circle cx="60" cy="28" r="8" fill="#FFF7C2" {...s} />
          <path d="M60 14 V18 M47 22 L50 24 M73 22 L70 24" stroke={palette.accent} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      );
    case 'treasure': // 尋寶：胸前一枚勳章
      return (
        <g data-part="story-prop">
          <path d="M54 92 L50 104 M66 92 L70 104" stroke={palette.accent} strokeWidth="4" strokeLinecap="round" />
          <circle cx="60" cy="92" r="7" fill="#FCD34D" {...s} />
          <path d="M60 88 L61.4 91 L64.5 91.3 L62.2 93.4 L62.8 96.4 L60 94.9 L57.2 96.4 L57.8 93.4 L55.5 91.3 L58.6 91 Z" fill="#fff" />
        </g>
      );
    case 'detective': // 偵探：一頂小帽子
      return (
        <g data-part="story-prop">
          <path d="M38 44 C40 26 80 26 82 44 Z" fill={palette.accent} {...s} />
          <rect x="32" y="42" width="56" height="7" rx="3.5" fill={palette.accent} {...s} />
        </g>
      );
    case 'competition':
    default: // 比賽：額頭一條頭帶＋星星
      return (
        <g data-part="story-prop">
          <path d="M26 54 C44 46 76 46 94 54" stroke={palette.accent} strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M60 44 L62.4 49 L68 49.6 L63.8 53.2 L65 58.6 L60 55.8 L55 58.6 L56.2 53.2 L52 49.6 L57.6 49 Z" fill="#FDE68A" {...s} />
        </g>
      );
  }
}

interface ReadingBabyAvatarProps {
  lessonUid: string;
  stage: ReadingBabyStage;
  /** 課名；有給的話無障礙名稱會是「〈課名〉的閱讀寶貝（階段）」。 */
  name?: string | null;
  size?: number;
  className?: string;
}

const ReadingBabyAvatar: React.FC<ReadingBabyAvatarProps> = ({ lessonUid, stage, name, size = 120, className }) => {
  const gid = useId().replace(/:/g, '');
  const look = appearanceFor(lessonUid);
  const unseen = stage === 'not_encountered';
  const label = unseen ? '還沒遇見的閱讀寶貝' : `${name ? `${name}的` : ''}閱讀寶貝（${STAGE_NAME[stage]}）`;

  if (!look || unseen) {
    return (
      <svg role="img" aria-label={label} viewBox="0 0 120 120" width={size} height={size} className={className}>
        <g data-part="silhouette" transform="translate(60 72) scale(0.82) translate(-60 -72)">
          <BodyShape type={look?.storyType ?? 'treasure'} fill="#D7DBE2" stroke="#B8BEC8" />
        </g>
      </svg>
    );
  }

  const { palette } = look;
  const scale = STAGE_SCALE[stage];
  const showHeld = stage === 'intermediate' || stage === 'advanced';
  const advanced = stage === 'advanced';

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      data-stage={stage}
      data-story-type={look.storyType}
    >
      {advanced && (
        <g data-part="glow">
          <defs>
            <radialGradient id={`glow-${gid}`}>
              <stop offset="0%" stopColor="#FFF3B0" stopOpacity="0.95" />
              <stop offset="70%" stopColor="#FFE08A" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#FFE08A" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="60" cy="66" r="58" fill={`url(#glow-${gid})`} />
          <path d="M16 30 l2 5 5 2 -5 2 -2 5 -2-5 -5-2 5-2z M102 20 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6-4 -4-1.6 4-1.6z M104 92 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4-3.4 -3.4-1.4 3.4-1.4z" fill="#F59E0B" />
        </g>
      )}
      <ellipse cx="60" cy="112" rx={30 * scale} ry="4" fill="#000" opacity="0.08" />
      <g transform={`translate(60 112) scale(${scale}) translate(-60 -112)`}>
        <g data-part="body">
          <BodyShape type={look.storyType} fill={palette.body} stroke={palette.outline} />
          <ellipse cx="60" cy="86" rx="21" ry="14" fill={palette.belly} />
          <PatternMarks pattern={look.pattern} color={palette.accent} />
        </g>
        <g data-part="face">
          <ellipse cx="47" cy="68" rx="5" ry="6" fill="#2B2B33" />
          <ellipse cx="73" cy="68" rx="5" ry="6" fill="#2B2B33" />
          <circle cx="48.6" cy="65.8" r="1.8" fill="#fff" />
          <circle cx="74.6" cy="65.8" r="1.8" fill="#fff" />
          <ellipse cx="40" cy="78" rx="5" ry="3" fill={palette.cheek} opacity="0.7" />
          <ellipse cx="80" cy="78" rx="5" ry="3" fill={palette.cheek} opacity="0.7" />
          <path d="M54 77 Q60 82 66 77" stroke="#2B2B33" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </g>
        {!showHeld && (
          <g data-part="badge" transform="translate(51 84) scale(0.75)">
            <circle cx="12" cy="12" r="13" fill="#fff" stroke={palette.outline} strokeWidth="2" />
            <g transform="translate(3 3) scale(0.75)">
              <AccessoryGlyph icon={look.accessory.icon} accent={palette.accent} outline={palette.outline} />
            </g>
          </g>
        )}
        {advanced && <StoryProp type={look.storyType} palette={palette} />}
      </g>
      {showHeld && (
        <g data-part="held-accessory" data-icon={look.accessory.icon} transform={`translate(${advanced ? 80 : 78} ${advanced ? 70 : 76}) scale(${advanced ? 1.4 : 1.25})`}>
          <AccessoryGlyph icon={look.accessory.icon} accent={palette.accent} outline={palette.outline} />
        </g>
      )}
    </svg>
  );
};

export default ReadingBabyAvatar;
