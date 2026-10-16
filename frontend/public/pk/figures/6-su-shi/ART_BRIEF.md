# PK 對手美術規格書 — 蘇軾（第 6 級）

> 產製方式：本案不叫任何其他 LLM 或繪圖生成模型 —— 由 Claude 以 SVG（向量圖形）繪製，
> 透過 `frontend/scripts/generate_pk_figures.py` 的共用產線產生，確保 7 位人物風格一致。
> 原創創作，不臨摹任何既有畫作、教科書插圖或其他遊戲的角色設計。

## 基本資料
- 朝代：宋代（song）
- 風格：扁平向量插畫（flat vector mascot），對國小學生友善，不做漫畫化嘲諷或滑稽變形

## 色票
| 用途 | 色值 |
|---|---|
| 袍服主色 | `#D08A4C` |
| 袍服暗部／領口 | `#A3652E` |
| 腰帶／配飾 | `#EADFC7` |
| 道具主色 | `#6B8E4E` |
| 膚色 | `#F2C9A0` |

## 頭飾
東坡巾——民間長期流傳、與蘇軾本人高度連結的傳統配飾

## 識別道具
道具：**staff** —— 依據作品：《定風波》——「竹杖芒鞋輕勝馬，誰怕？一蓑煙雨任平生」

## 服飾朝代備註
宋代交領直裰 —— 示意性的傳統美術元素，不宣稱精確還原歷史服裝。

## 資產清單
- `icon.svg`（48×48，列表／分數條頭像用，不含表情變化）
- `portrait-idle.svg` / `portrait-thinking.svg` / `portrait-happy.svg` /
  `portrait-impressed.svg` / `portrait-frustrated.svg` / `portrait-victory.svg` /
  `portrait-defeat.svg`（220×300，VS 畫面／生平動畫／結果頁用，7 種表情共用同一套
  髮型／袍服／道具，只有臉部表情局部不同 —— PRD §10.5.3）

## 表情對照（PRD §10.5.3 事件 -> 表情）
| 事件 | 表情檔 |
|---|---|
| 進入「選一位對手」畫面／對戰尚未開始 | `portrait-idle.svg` |
| 學生作答倒數進行中 | `portrait-thinking.svg` |
| 揭曉：AI 這題自己答對 | `portrait-happy.svg` |
| 揭曉：學生這題答對 | `portrait-impressed.svg` |
| 揭曉：AI 這題自己答錯 | `portrait-frustrated.svg` |
| 結果畫面，AI 贏 | `portrait-victory.svg` |
| 結果畫面，學生贏 | `portrait-defeat.svg`（有風度，絕不嘲笑學生 —— 鐵律）|

## 重畫／調整風格依據
之後如需重畫或調整風格，改 `frontend/scripts/generate_pk_figures.py` 裡
`TIERS` 清單中 tier=6（slug="su-shi"）的設定，並重新執行該腳本 ——
不要個別手改產出的 SVG 檔，否則下次重新產生時手改內容會遺失。
