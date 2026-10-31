import type { IslandStop, IslandBaby } from './islandTemplate';

export const STOPS_20011: IslandStop[] = [
  { name: '港口燈塔', step: 'lesson-intro', x: -3, z: 11, zone: 0, line: '燈要亮，先叫出她的名字' },
  { name: '書卷長廊', step: 'full-text-annotate', x: -9, z: 5, zone: 0, line: '每一卷都有一段話，按順序走，別跳' },
  { name: '回音劇場', step: 'key-passage-reading', x: 3, z: 2, zone: 0, line: '這裡的歡呼和嘆氣，都是同一場比賽' },
  { name: '字源館', step: 'vocab-definition', x: 12, z: -4, zone: 1, line: '一個字拆開，裡面藏著它的意思' },
  { name: '工匠作坊', step: 'vocab-application', x: 5, z: -10, zone: 1, line: '要做出那一球，材料就在課文第二段' },
  { name: '地圖塔', step: 'keypoints-table', x: 17, z: -12, zone: 1, line: '兩條路都到得了終點，你猜她走哪條' },
  { name: '謎題神殿', step: 'comprehension', x: 23, z: -20, zone: 2, line: '答案不在題目裡，在她做的事裡' },
  { name: '精靈牧場', step: 'vocab-review', x: 14, z: -24, zone: 2, line: '找回來的字寶寶在這裡休息，記得回來看牠們' },
  { name: '樹屋補給站', step: 'knowledge-station', x: 2, z: -22, zone: 2, line: '累了嗎？她落後七分的時候也沒停' },
  { name: '星空瞭望台', step: 'report', x: 22, z: -32, zone: 2, line: '最後一個問題，要用你自己的話回答' },
];

export const OPENING_20011 = [
  ['旁白', '這座島，本來很吵'],
  ['銀牌', '輸掉的人，為什麼有人為她拍手？'],
  ['小翎', '你……會讀字嗎？'],
  ['小翎', '它們是字變的，可是忘了自己是誰'],
  ['小翎', '先找到她的名字，燈就會亮一點'],
  ['小翎', '聽到了嗎？有人在等掌聲回來'],
];

export const BABIES_20011: IslandBaby[] = [
  { name: '龍爭虎鬥', art: 'dragon-tiger.png', x: -7, z: 7 },
  { name: '勢均力敵', art: 'scale.png', x: 0, z: 4 },
  { name: '目不轉睛', art: 'owl.png', x: 5, z: 1 },
  { name: '捶胸頓足', art: 'stone.png', x: 9, z: -8 },
  { name: '凝聚力', art: 'orbs.png', x: 16, z: -17 },
  { name: '摸不著頭緒', art: 'yarn.png', x: 7, z: -21 },
];
