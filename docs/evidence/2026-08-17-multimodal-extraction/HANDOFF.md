# 接手指南 — #2736 多模態抽取

> **抽取之後要做什麼** → `docs/2026-08-18-二修教材上線-TODO.md`
> （上線 / 人類簽核 / 防止原稿靜默過期 / 舊管線退場 / 學習閉環）

> 給下一個 session。照這份走就能繼續，不需要回頭讀對話。
> 最後更新：2026-08-18，commit 見 `git log`（抬頭的數字可能落後，**以 `ls backend/data/lessons/_extracted/*.yml | wc -l` 為準**）

## 現在在哪

**九道門全綠。** 分支 `fix/issue-2736-truth-l0072`，PR #2739。
課數不寫在這裡（抬頭的數字一定會過期）—— 跑下面那條指令看。

```bash
cd /Users/young/project/clp-2736
ls backend/data/lessons/_extracted/*.yml | wc -l     # 權威數字看這個
python3 scripts/build_progress_table.py              # 重生成進度表
```

⚠️ `docs/evidence/2026-08-17-multimodal-extraction/PROGRESS.md` 是**生成的**，
不要手改。手維護的表會記得「我做過」，不會記得「後來被丟了」。

## 這是什麼問題

175 份國語文學習單要從**舊抽取器**（regex + XML）換成**多模態抽取**（LLM 逐頁讀 PDF）。

舊管線失敗的原因不是規則寫錯，是**內容有五種載體而它只讀得到一種半**：

| 載體 | 舊管線 | 實測 |
|---|---|---|
| DOCX 文字流 | 讀，但漏文字方塊 | 175/175 課有文字方塊，中位 64 個/課 |
| DOCX 圖形層（橘圈、手繪連線、疊印壓掉的表格）| **讀不到** | 見下 |
| DOCX 版面關係（☞ 錨點、印刷段號） | 誤當索引 | #2720 |

### ⚠️ 這裡原本寫錯了一句，而且是最關鍵的那句

原文寫「`☑` 在文字流出現 0 次的課：169/175」→「所以答案只有看圖才拿得到，
這就是多模態存在的理由」。**那句話量錯了東西** —— 它量的是字面字元 `☑`，
而勾選在 DOCX 裡編碼成 `<w:sym w:font="Wingdings" w:char="F0FE"/>`（沒有 `w:t`）。

全庫實測：**157/175 份用 `w:sym F0FE`（共 1807 個），字面 `☑` 出現 0 份。**
換句話說，**多數課的勾選就在 `document.xml` 裡**，grep 得到。

→ 找勾選一律 `grep 'w:char="F0FE"'` **搭配**讀圖。多模態仍然必要，但理由要換成準的：

- **圖補 XML 的洞**：橘色圈選、手繪連線、「圈住第幾個」這種位置型答案，文字層沒有
- **XML 補圖的洞**：LibreOffice 會把某些表格疊印壓掉，那幾格在 PDF 上完全看不到勾
  （L0061 有 6 個 F0FE 是這樣救回來的）
- 第三種載體：**`<w:bdr>` 非 auto 顏色的字元框線**（框選語詞），前兩種做法都讀不到

⚠️ 這個更正 2026-08-18 才做。**如果你讀到別處還寫著「☑ 只有看圖才拿得到」，那是舊的。**

## 怎麼繼續抽

### 派工

3 個 worker、**一個 worker 3 課**。不要一課一個 worker——抽完一課就立刻寫檔，
worker 中途掛掉前面幾課都還在；而讀 skill 的固定成本每個 worker 只付一次。

派工單模板見本檔末。核心是叫他們**完整讀 `.claude/skills/extract-lesson-multimodal/SKILL.md`**，
那裡面有 14 個型別的封閉清單、重點表兩種佈局、段號規則、找字遊戲形狀。

下一批從這裡拿：

```bash
python3 - <<'PY'
import yaml
from pathlib import Path
L = Path('backend/data/lessons')
done = {p.stem for p in (L/'_extracted').glob('*.yml')}
for d in sorted(L.iterdir()):
    if not d.is_dir() or not d.name.startswith('L0') or d.name in done: continue
    lf = d/'v2/lesson.yml'
    if not lf.exists(): continue
    dp = ((yaml.safe_load(lf.read_text(encoding='utf-8')) or {}).get('source') or {}).get('drive_path')
    if dp: print(f"{d.name}\t{dp}")
PY
```

### 節奏

- **5 分鐘檢查一次 worker**，空了就派下一批
- worker 撞 session 額度（會回 idle + failureReason）→ **開新的**，不要等
- **每 10 課過閘門 → commit → push**。不要累積，工作不能白做

### 收件時自己重跑閘門，不採信 worker 的宣稱

```bash
source /Users/young/project/chinese-literacy-platform/backend/.venv/bin/activate
python3 scripts/split_lesson_modules.py --all --version v3
python3 scripts/verbatim_all.py          # 逐字門（全庫版）—— 原本只有逐課介面，不在例行掃描裡
python3 scripts/coverage_gate.py --all
python3 scripts/traditional_only_gate.py --all
python3 scripts/normalize_block_types.py --check
python3 scripts/normalize_word_search.py --check
python3 scripts/keypoints_shape_gate.py --all --legacy-ok
python3 scripts/render_coverage_gate.py
python3 scripts/orphan_key_gate.py
python3 scripts/sot_drift_check.py
cd backend && python -m pytest specs/ -q
```

⚠️ **`pytest specs/` 一定要跑。** 我有一輪的派工清單只列了 gate script 沒列它，
於是有課的 spec 契約紅著交上來（`single needs >=2 options`），而九道門全綠。

⚠️ 有一次我在 worker 還在寫檔的當下跑閘門，讀到半寫的檔案報 FAIL。**重跑就好**。

## 九道門各管什麼、看不到什麼

| 門 | 抓什麼 | **看不到什麼** |
|---|---|---|
| `verbatim_gate.py` | 潤稿、看錯字形、改到原稿 | **漏抄**（少一段，剩下的字還是對的）|
| `coverage_gate.py` | 整段課文沒抽到 | 課文以外的漏抄；而且它的基準 v2 body 對某些課混入了攤平的聚光燈內容 → **它列的是候選不是判決** |
| `traditional_only_gate.py` | 照 PDF 抄到被字型換掉的字形 | 圖上的字（`text_carrier: image`）、我方自己寫的評註（刻意跳過）|
| `normalize_block_types.py` | 發明型別、YAML 裸 `no:` 陷阱 | 比 block 高一層的東西 |
| `normalize_word_search.py` | 找字座標轉錯 | |
| `keypoints_shape_gate.py` | 重點表畫不出東西（空表格）| |
| `render_coverage_gate.py` | 型別沒有對應元件 | 資料沒進 v3 的東西（沒被渲染就看不到）|
| **`orphan_key_gate.py`** | **top-level key 沒有人搬 → 整節靜默消失** | |
| **`verbatim_all.py`** | **逐字門的全庫版** | 同逐字門（漏抄看不到）|

第九道 2026-08-18 新增。逐字門是主門，但它的介面是**逐課**的（`--yaml`+`--docx`），
八道門的例行掃描裡沒有它 —— 於是一課可以在**逐字門從沒執行過**的情況下進 repo。
真的發生了（L0122 帶著 3 處對不上被 commit），而抓到它的是 `sot_drift_check` 的副作用
（`docx_md5` 只在逐字門通過時才蓋，沒指紋反過來洩漏了它沒過）。

第八道 2026-08-18 新增。起因是一個 worker 把「知識補給站」寫成 `supplement`
（搬運表叫 `resources`）→ 整節被丟掉，**而前七道全綠**。掃全庫發現同一個形狀
影響 15 課 4 個 key。沒有一道舊門在看那一層：逐字門驗「寫下來的對嗎」、
覆蓋率門比課文段落、型別門看 block 的 `type`（低一層）、渲染門只看得到已進 v3 的資料。

**新增門的時候要問「它看不到什麼」，不是「它看得到什麼」**。這一輪抓到的三個
「所有閘門都綠但東西是壞的」，共通形狀是**壞掉的東西剛好在每道門的背面**。

## 已知的坑（都踩過，別再踩）

### 🔴 PDF 上的簡體字是假的

教材標題字型是 `DFFangYuanW7-GB5`（華康方圓體的**簡體字集版**），它把正體碼位
畫成簡體字形。**PDF 文字層是正確的正體字**，只有「畫出來的樣子」是簡體。

→ **文字一律以 `document.xml` 為準**，PDF 只提供文字層沒有的東西（紅 ☑、橘圈、版面關係）。
真的畫在圖片像素裡的字才從 PDF 讀，並標 `text_carrier: image`。

⚠️ 這是教材端的問題：**教材標題在任何沒裝那套字型的機器上都會顯示簡體**，
包括未來線上呈現。

### 🔴 LibreOffice 的 profile 鎖會讓平行抽取全體卡死

所有 headless 轉檔共用同一個 user profile 並對它上鎖，第二個進來**不報錯、不退出**，
就掛在那裡等。有一輪的殭屍霸著鎖 5 小時，之後每個 worker 一轉 PDF 就卡住，
現象是「平行抽取好慢」。

→ **一律走 `scripts/docx_to_pdf.sh`**，不要自己敲 soffice。它包了樣板 profile
（避開每次 4 分鐘的 bootstrap）、過期殭屍清理、timeout、產出與頁數檢查。
卡住時先跑 `scripts/docx_to_pdf.sh --doctor`。

實測（三個同時轉）：裸 soffice → **0 個 PDF**、兩個逾時；這支 → 3/3、2.9 秒。

### 🔴 PDF 會漏掉文字層裡明明有的東西

不只簡體字代換。有一課兩張結構圖的【 】答案**都在 `document.xml` 的文字流裡**，
但 LibreOffice 轉出的 PDF 把那幾格畫成空白 —— 只看 PDF 會判成「這一節沒答案」。

→ 凡是 PDF 上看起來「空的、缺的、沒印」的地方，**回去查一次文字層再下結論**。

### 🔴 格子印錯字是通例（已 4 課）

突發**其**想／朝思**慕**想／愧**咎**／堅不可**催** —— 全是同音或形近字，
而且都藏在格子裡不在詞庫。

**回頭逐格取字確認**，不要把座標塞進去湊數。

⚠️ 我一度寫「roundRect 數 ≠ 路徑數就警告」**不成立、要放棄** —— 那個結論
**2026-08-18 已被推翻一半**，正確版在 SKILL.md「個數只能當單向警報」那節：

1. 只數 `<wp:anchor>` 裡的 roundRect（不是全文件，全文件到處都是所以才會噴 26 vs 10）
2. 扣掉**錨在紙外**的殘留（`positionH` 的基準加回去換算超過頁寬 7563600 EMU）
3. 只有 **`紙上 roundRect > 路徑數`** 一個方向算警報；反向什麼都不代表
   （圈選常用別種圖形畫，roundRect 不是全部）

17 課回測：4 課相等、13 課少於、**0 課多於**。沒有第 2 步的話 L0069／L0061／L0035
都會誤報 —— 那正是當初讓我放棄的雜訊。

⚠️ 而第 2 步也有邊界（w3 在 L0068 測出來）：溢出有兩種，posOffset 只認得
「錨點被放到紙外」，認不得「錨點位移正常但掛在儲存格裡被排版推出去」——
後者只有像素驗得到。**判準沒命中不代表沒有殘留。**

### 🔴 有一課轉不出 PDF（L0028）

LibreOffice 26.2.2.2 對它 99% CPU 跑到逾時，換 ODT 中介一樣。正向對照（同支腳本
轉別課秒過）證明是那份 DOCX 的內容問題。worker 改用 `w:sym` F0FE 抓 ☑、
`w:bdr` 抓框選語詞，並**先拿已知會過的課驗證方法可信**才用。仍缺找字遊戲的圈選路徑。

**L0028 與 L0029 在重跑清單上**（等 PDF 轉得出來補圈選 / 手繪連線）。

### 🔴 L0084 連續燒掉兩個 worker（content filter）

`7年級/G7-L16長大後，我才讀懂〈夏夜〉…docx`（文字層 7774 字）。
兩個不同的 worker 拿到它都以 `API Error: Output blocked by content filtering policy`
結束 —— 一個交完前兩課死在它身上，一個一課都沒交。**共同因子只有這一課，不是隨機。**

⛔ **不要再原樣派給第三個 worker**，那只會再燒一個。

**2026-08-18 查到的線索**（不是結論）：
- **文字層完全無害** —— 楊喚〈夏夜〉的排比教學，6655 字，內容平常
- **26 個 media 檔**，而兩個 worker **都是在讀圖階段死的**（一個交完前兩課才死、
  一個一課都沒交）
→ 觸發點比較可能在**圖**不在文字，但**沒有證實**。

未驗證的做法（照成本排）：
1. **只從 XML 抽文字部分**（課文、題目、指示語都在文字層），圖只在必要時單張讀
2. 分頁抽：一次讀 2~3 頁而不是整課，撞到就知道是哪幾頁
3. 工頭自己逐頁處理（同樣有撞的風險，但至少不會讓一個 worker 的整批工作陪葬）

⚠️ 不管走哪條，**先把已完成的部分寫檔再讀下一頁** —— 前兩次失敗都是整批歸零。

**L0084 在重跑清單上。**

### ⚠️ 判準錯的門比沒有門更糟

正體字門我做了四次才對，前三次用手打的簡體字清單，每一輪都混進正體字
（只／起／里／干／累），每一輪都把一整批正確的課判成 FAIL。**它會叫人去改沒有壞的東西。**

現在的判準是**全庫 175 份原稿的用字聯集**——經驗定義、自我修正、灰色地帶自己就對
（「拮据」的据、引用頻道名「有点意思」的点都在原稿裡）。

⚠️ **測這道門不要拿正簡兩用的字**（有 worker 用「响」測，門 PASS 而以為門壞了）。

### ⚠️ mutation 要確認真的改到檔案，而且要打在真資料上

我有一次把 mutation 打進 YAML **註解**裡，`yaml.safe_load` 根本讀不到，
於是「門沒紅」被我誤讀成門失效。

## 兩個仍未解的 schema 缺口

1. **雙文本課**（L0029 那種：兩篇 + 三篇合讀，大題編號中途重來）
   `keypoints` 只吃一組 `rows`、`key_reading` 只有一個範圍。目前 worker 把第二篇
   原樣放 `keypoints.part2_table` 並註明門看不到它。要擴 schema。

2. **手繪連線的答案**（連連看）
   要把每個 drawing anchor 的頁面座標和表格儲存格座標一起還原才判得出哪條連哪對。
   目前標 `answers_not_transcribed: true` 不猜。

## 教材本身的問題（累積中）

`docs/evidence/2026-08-17-multimodal-extraction/教材勘誤表.md`

- **第一區 26 筆**：可直接照改（漏字、贅字、括號寫反、大題序號印錯）
- **第二區**：需要編輯判斷的落差（總表 G5-L3/L4 語詞整組互換、命題引用的句子不在現行課文裡）

⛔ **兩區不可以合併**。第一區是拿去請人照著改的，混進需要決定的東西整張表就不能直接執行。

有兩筆勘誤已經拿到回報：L0124 那兩筆（重複標點、贅字）在教材 8/17 更新時**被修正了**。

## 教材更新怎麼查

```bash
python3 scripts/sot_drift_check.py                              # 0=一致 1=有差異
python3 scripts/sot_drift_check.py --backup /tmp/sot-$(date +%F) # 同步前先備份
```

它問**兩個不同的問題**，缺一不可：
1. 本機快照 vs Drive（「你手上這份過期了」）
2. 抽取時記的原稿指紋 vs 現在的原稿（「這份抽取結果本身作廢了」）

只做第 1 條的話，**同步完訊號就消失**，作廢的 yml 會靜靜留在庫裡。

⛔ 拉檔用 `rclone copy`（只寫本機），**不要用 `sync`**——方向弄反會清空 Drive，hook 會擋。

## codex 的定位

**看得到紅色 ☑**（拿已知答案考過），而且**不吃 Claude 額度**。

- ✅ 適合：獨立覆核「這題到底勾了哪個」（producer ≠ auditor）
- ❌ 不適合：整課抽取（11 頁一次餵超過 10 分鐘沒產出）

用法：`scripts/codex_qa_lesson.sh <UID> [頁碼...]`

這一輪用它確認了 6 題「教師版到底有沒有勾」，避免我憑讀題目自己判斷。

## 中途發現新規則 → 兩件事，缺一不可

skill 檔是熱的，**worker 的 context 是冷的** —— 它開場把 SKILL.md 讀進 context，
之後不會再讀第二次。所以：

1. **寫進 SKILL.md** — 給之後才 spawn 的 worker
2. **SendMessage 廣播給所有在跑的 worker** — 給現在這批（每一個都要，不是只給發現的那個）

⚠️ **只做第 1 步不會有任何症狀**：這批課照舊規則抽完，所有閘門照樣綠，
沒有錯誤訊息 —— 就是靜默漏抓。

2026-08-18 兩次：`w:sym F0FE`（廣播了，對）、找字紙外殘留（一開始只推給發現者
w4，其餘五個手上都還有找字課，補推才齊）。

## 派工單模板

```
在 worktree `/Users/young/project/clp-2736` 抽三課教材：<UID1>、<UID2>、<UID3>。

**先完整讀 `.claude/skills/extract-lesson-multimodal/SKILL.md`**，整支流程照它走。

原稿（`SOT=private/curriculum-source/_SOT`）：
- <UID1> → <drive_path>
- ...

輸出 → `backend/data/lessons/_extracted/<UID>.yml`

## 鐵律
1. 每一頁都要讀，不抽樣
2. 型別封閉清單 14 個，不可發明
3. 重點表只有兩種佈局（`layout: list` / `layout: matrix`）；matrix 的 row key 必須跟 columns 逐字相同
4. YAML 裸 `no:`/`yes:` 會被解析成 boolean，一律寫 `"no":`
5. 題幹欄位：`spotlight.blocks[]` 用 `prompt`，`comprehension.items[]` / `vocab_application.items[]` 用 `stem`
6. 段號用學習單印的；段號欄外的未編號引言 → `body.preface`
7. 沒有標準答案的題目標 `no_correct_answer: true`；有答案但教師版沒印用 `answers_printed: false`
8. 文字一律以 document.xml 為準（PDF 的簡體是字型代換的假象）
9. 轉檔走 `scripts/docx_to_pdf.sh`，不要自己敲 soffice

## 交件前九道門 + `pytest specs/ -q` 全跑（貼實際輸出）
[見上方閘門清單]

不 commit、不 push、不改 scripts/ frontend/ backend/app/。
每抽完一課回報一行。
```

## 這批 worker 的表現值得知道

他們反覆抓到**我給錯的指令**，而且是靠查證而不是照做：

- 我說「題幹一律用 `prompt`」→ worker 去讀 `lesson_indexes.py` 發現那兩節讀的是 `stem`，
  照我說的改會讓題目在畫面上變空白**而且不報錯**
- 我說「幾何驗證當主判準」→ worker 拿四課回測，數 roundRect 三課對不上，
  正確用法是拿 cells 套回 grid 拼字（比內容不比數量）
- worker 發現 `section_no` 常數表對 39 課寫反，自己去掃了 175 份原稿量出 70 vs 39

**派工單裡要保留「發現指令有問題就回報，不要照做」這個空間。**
