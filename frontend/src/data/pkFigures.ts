/**
 * The seven PK AI opponents — PRD §5.1/§10.3/§10.5. Single source shared by
 * the intro biography animation (full + condensed) AND the unlocked
 * figure-card display (PRD §10.3: "動畫腳本與人物卡...避免內容兩邊各寫一次").
 *
 * Every biographical beat is tagged `kind: 'fact' | 'legend'` — PRD §10.3's
 * "傳說" vs "信史" distinction must survive into the UI, not just the PRD
 * text. Quotes are real, attributed classical works (§10.3/§10.5.2); the
 * modern-voice reaction lines (§10.5.3) are NOT classical quotes except for
 * the two "victory"/"happy" expressions, which deliberately reuse a cited
 * quote because it fits the celebratory tone (PRD §10.5.3).
 */

export type PkEra = 'tang' | 'song';

export interface PkBioBeat {
  text: string;
  kind: 'fact' | 'legend';
  source?: string;
}

export type PkExpressionKey =
  | 'idle'
  | 'thinking'
  | 'happy'
  | 'impressed'
  | 'frustrated'
  | 'victory'
  | 'defeat';

/** PRD §10.5.3 event -> expression map, plus each expression's short line. */
export const EXPRESSION_LABELS: Record<PkExpressionKey, string> = {
  idle: '待機／準備',
  thinking: '思考中',
  happy: '開心（自己答對）',
  impressed: '驚訝／佩服（對手答對）',
  frustrated: '挫折但友善（自己答錯）',
  victory: '獲勝',
  defeat: '落敗（有風度，絕不嘲笑）',
};

export interface PkFigure {
  tier: number;
  slug: string;
  name: string;
  era: PkEra;
  years: string;
  epithet: string;
  speedLabel: string;
  prop: { name: string; work: string; note?: string };
  bio: [PkBioBeat, PkBioBeat, PkBioBeat];
  quote: { text: string; work: string };
  /** PRD §10.5.3: only "victory"/"happy" use the real classical quote; the
   * rest are modern plain-language lines (filled per figure, friendly tone,
   * never mocking on defeat-for-the-student side). */
  lines: Record<PkExpressionKey, string>;
}

export const PK_FIGURES: PkFigure[] = [
  {
    tier: 1,
    slug: 'luo-binwang',
    name: '駱賓王',
    era: 'tang',
    years: '約 619–687 年後',
    epithet: '初唐四傑之一',
    speedLabel: '慢',
    prop: { name: '鵝', work: '《詠鵝》' },
    bio: [
      {
        text: '相傳 7 歲作《詠鵝》——「鵝鵝鵝，曲項向天歌」',
        kind: 'legend',
        source: '確切年齡歷來有爭議，但「神童」形象是蒙學教材長期收錄、流傳最廣的公眾印象',
      },
      { text: '後來寫下《為徐敬業討武曌檄》，公開起兵討伐武則天的檄文', kind: 'fact', source: '《舊唐書・文苑傳》' },
      {
        text: '684 年起兵失敗後下落不明，有人說他出家為僧',
        kind: 'legend',
        source: '《新唐書》記載其「亡命不知所之」，後世多種說法並存',
      },
    ],
    quote: { text: '鵝鵝鵝，曲項向天歌', work: '《詠鵝》' },
    lines: {
      idle: '準備好了嗎？我們開始吧。',
      thinking: '讓我想想……',
      happy: '這題我會！',
      impressed: '你讀得真仔細。',
      frustrated: '唉，猜錯了。',
      victory: '鵝鵝鵝，曲項向天歌！',
      defeat: '你學得真好，再來一場？',
    },
  },
  {
    tier: 2,
    slug: 'meng-haoran',
    name: '孟浩然',
    era: 'tang',
    years: '689–740',
    epithet: '盛唐山水田園詩人',
    speedLabel: '慢',
    prop: { name: '春日曉色（晨光、鳥鳴）', work: '《春曉》' },
    bio: [
      { text: '年輕時隱居鹿門山苦讀，40 歲才到長安考科舉', kind: 'fact', source: '《新唐書・文藝傳》' },
      { text: '考試落第，終生沒有擔任重要官職，一生大多在襄陽一帶遊歷、寫詩交友', kind: 'fact', source: '《新唐書・文藝傳》' },
      {
        text: '相傳晚年背上生瘡將癒，與好友王昌齡飲宴時貪食鮮魚引發舊疾復發去世',
        kind: 'legend',
        source: '病逝情節傳說成分較高，來源：後世傳記轉述',
      },
    ],
    quote: { text: '春眠不覺曉，處處聞啼鳥', work: '《春曉》' },
    lines: {
      idle: '準備好就開始吧。',
      thinking: '嗯……讓我讀讀看。',
      happy: '答對了，真好。',
      impressed: '你比我快呢。',
      frustrated: '沒關係，下一題。',
      victory: '春眠不覺曉，處處聞啼鳥。',
      defeat: '你讀得很用心，再戰一場？',
    },
  },
  {
    tier: 3,
    slug: 'bai-juyi',
    name: '白居易',
    era: 'tang',
    years: '772–846',
    epithet: '中唐詩人',
    speedLabel: '中',
    prop: { name: '琵琶', work: '《琵琶行》' },
    bio: [
      {
        text: '主張詩要寫給一般人看得懂，相傳每寫完一首詩會唸給不識字的老婦人聽，聽不懂就修改',
        kind: 'legend',
        source: '後世筆記如《冷齋夜話》轉述，非白居易本人記載',
      },
      { text: '推動「新樂府運動」，用詩記錄百姓的苦', kind: 'fact', source: '《舊唐書・白居易傳》' },
      { text: '代表作《長恨歌》《琵琶行》流傳極廣，「同是天涯淪落人」一句後世幾乎人人能接下句', kind: 'fact' },
    ],
    quote: { text: '同是天涯淪落人，相逢何必曾相識', work: '《琵琶行》' },
    lines: {
      idle: '來吧，我們切磋一下。',
      thinking: '這句話是什麼意思呢……',
      happy: '這個我讀過！',
      impressed: '你解釋得比我清楚。',
      frustrated: '這題我會錯意了。',
      victory: '同是天涯淪落人，相逢何必曾相識。',
      defeat: '你讀懂了，很棒，再來一場？',
    },
  },
  {
    tier: 4,
    slug: 'li-qingzhao',
    name: '李清照',
    era: 'song',
    years: '1084–約1155',
    epithet: '宋代第一女詞人',
    speedLabel: '中',
    prop: { name: '菊花／西風', work: '《醉花陰》「簾捲西風，人比黃花瘦」' },
    bio: [
      {
        text: '出身書香世家，與丈夫趙明誠共同蒐集金石古物、校勘古籍',
        kind: 'fact',
        source: '李清照自撰《金石錄後序》，第一手自傳材料',
      },
      { text: '1127 年靖康之難，北方淪陷，南逃途中大量珍藏的古物散失', kind: 'fact', source: '《金石錄後序》' },
      { text: '丈夫趙明誠 1129 年病逝，晚年詞風從早年的閨閣悠然轉為漂泊淒涼', kind: 'fact' },
    ],
    quote: { text: '知否，知否？應是綠肥紅瘦', work: '《如夢令》' },
    lines: {
      idle: '請開始作答。',
      thinking: '容我想想……',
      happy: '這個詞我熟悉。',
      impressed: '你答得真快。',
      frustrated: '這題我失手了。',
      victory: '知否，知否？應是綠肥紅瘦。',
      defeat: '你答得很好，要不要再戰一場？',
    },
  },
  {
    tier: 5,
    slug: 'du-fu',
    name: '杜甫',
    era: 'tang',
    years: '712–770',
    epithet: '詩聖',
    speedLabel: '中快',
    prop: { name: '茅屋', work: '《茅屋為秋風所破歌》' },
    bio: [
      { text: '經歷安史之亂，親眼見到戰亂中百姓的苦難，詩被後世稱為「詩史」', kind: 'fact', source: '《舊唐書・杜甫傳》' },
      { text: '一生仕途不順，多次擔任小官或完全沒有官職，生活困頓', kind: 'fact' },
      { text: '770 年病逝於湘江上的一艘船中', kind: 'fact', source: '《新唐書・杜甫傳》' },
    ],
    quote: { text: '安得廣廈千萬間，大庇天下寒士俱歡顏', work: '《茅屋為秋風所破歌》' },
    lines: {
      idle: '準備應戰。',
      thinking: '讓我讀懂這句話。',
      happy: '這題不難。',
      impressed: '你讀得比我透徹。',
      frustrated: '唉，可惜。',
      victory: '安得廣廈千萬間，大庇天下寒士俱歡顏！',
      defeat: '你讀得真好，再來一場如何？',
    },
  },
  {
    tier: 6,
    slug: 'su-shi',
    name: '蘇軾',
    era: 'song',
    years: '1037–1101',
    epithet: '號東坡居士',
    speedLabel: '快',
    prop: { name: '竹杖與芒鞋', work: '《定風波》「竹杖芒鞋輕勝馬，誰怕？一蓑煙雨任平生」' },
    bio: [
      { text: '才華橫溢，詩詞文章書法繪畫樣樣精通', kind: 'fact' },
      {
        text: '1079 年因「烏臺詩案」被控以詩諷刺朝政，下獄約 130 天，後被貶至黃州',
        kind: 'fact',
        source: '《宋史・蘇軾傳》',
      },
      {
        text: '相傳在黃州期間生活清苦，自己研究出一道豬肉料理，後人稱「東坡肉」',
        kind: 'legend',
        source: '流傳很廣的民間說法，料理起源細節多屬後世地方傳說',
      },
    ],
    quote: { text: '但願人長久，千里共嬋娟', work: '《水調歌頭》' },
    lines: {
      idle: '來，較量一下！',
      thinking: '且讓我讀讀看。',
      happy: '哈，這題簡單！',
      impressed: '好眼力！',
      frustrated: '唉呀，失算了。',
      victory: '誰怕？一蓑煙雨任平生！',
      defeat: '你答得真好，再來一局？',
    },
  },
  {
    tier: 7,
    slug: 'li-bai',
    name: '李白',
    era: 'tang',
    years: '701–762',
    epithet: '詩仙',
    speedLabel: '非常快',
    prop: { name: '月亮與酒杯', work: '《月下獨酌》「舉杯邀明月，對影成三人」' },
    bio: [
      { text: '性格豪放不羈，詩裡常有飛天、仙人、美酒的想像', kind: 'fact' },
      { text: '曾經一度受唐玄宗賞識，在宮中擔任翰林供奉，但不久便離開長安繼續雲遊四方', kind: 'fact', source: '《新唐書・文藝傳》' },
      {
        text: '正史記載他病逝於族叔李陽冰家中',
        kind: 'fact',
        source: '《舊唐書・文苑傳》；民間「醉酒撈月而死」是後世浪漫化的傳說，不是正史',
      },
    ],
    quote: { text: '舉頭望明月，低頭思故鄉', work: '《靜夜思》' },
    lines: {
      idle: '來，看你能不能跟上我！',
      thinking: '這題嘛……',
      happy: '一揮而就！',
      impressed: '你也很快嘛！',
      frustrated: '這題我倒是失手了。',
      victory: '舉杯邀明月，對影成三人！',
      defeat: '你答得真好，敢不敢再戰一場？',
    },
  },
];

export function getPkFigure(tier: number): PkFigure {
  const f = PK_FIGURES.find((x) => x.tier === tier);
  if (!f) throw new Error(`Unknown PK figure tier: ${tier}`);
  return f;
}

// PK gamification MVP (launch-plan, 2026-10-17): Li Bai (tier 7) already has
// a richer, game-quality PNG illustration set committed under
// frontend/public/story-assets/pk-li-bai/ (see _prompts.json there — it was
// produced in an earlier session via codex image_gen, generalized from the
// 跨班賽季 story-pack work). This map is the SINGLE place that decides "which
// art source wins" for a figure — every call site (VS screen, battle screen,
// result screen, opponent-select, figure intro) goes through
// pkFigureAssetPath/pkFigurePortraitUrl/pkFigureIconUrl, so adding a figure's
// richer set here switches its art everywhere at once instead of each
// screen having to special-case it.
//
// #3745: the other six figures were still on the placeholder-quality SVG
// set (only Li Bai looked finished on the opponent-select screen). Same
// codex image_gen pipeline, same _prompts.json convention per figure dir —
// each dir's portrait-idle.png was used as the per-figure reference so every
// expression stays the same person, and Li Bai's portrait-idle.png seeded
// the very first idle image for each of the six (as "a DIFFERENT person")
// so all seven share one illustration style.
const PK_PNG_ART_OVERRIDE: Partial<Record<number, string>> = {
  1: '/story-assets/pk-luo-binwang',
  2: '/story-assets/pk-meng-haoran',
  3: '/story-assets/pk-bai-juyi',
  4: '/story-assets/pk-li-qingzhao',
  5: '/story-assets/pk-du-fu',
  6: '/story-assets/pk-su-shi',
  7: '/story-assets/pk-li-bai',
};

// #3602 B5: was `/pk/figures/...`, served from frontend/public/pk/ — that
// directory collides with the SPA's own `/pk` route (nginx's
// `try_files $uri $uri/ /index.html` sees a real `pk` directory in the
// docroot and 301s `/pk` -> `/pk/`, then 403s on `/pk/` itself instead of
// ever reaching index.html). Moved to frontend/public/pk-art/, which has no
// matching client route.
export function pkFigureAssetPath(tier: number, file: string): string {
  const f = getPkFigure(tier);
  const pngDir = PK_PNG_ART_OVERRIDE[tier];
  if (pngDir) {
    return `${pngDir}/${file.replace(/\.svg$/, '.png')}`;
  }
  return `/pk-art/figures/${f.tier}-${f.slug}/${file}`;
}

export function pkFigurePortraitUrl(tier: number, expression: PkExpressionKey): string {
  return pkFigureAssetPath(tier, `portrait-${expression}.svg`);
}

export function pkFigureIconUrl(tier: number): string {
  return pkFigureAssetPath(tier, 'icon.svg');
}
