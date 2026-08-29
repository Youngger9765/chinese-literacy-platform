# QR 定址重構 —— 一課多篇、多念順順，且印出去之後還能改

> 狀態：草案 2026-08-24｜關聯 #2916（一課多篇的 yml 形狀）
> 起因：2026-08-24 與 PM 的通話。三件事同時撞在一起 —— QR 指到測試站、
> 一課多篇沒有各自的 QR、後台課號跟紙本對不起來。三件事**是同一個根因**：
> **我們把「現在的實作細節」印到了紙上。**

---

## 0. 一句話

**QR 上只印一個不帶語意的代號，掃進來由後端決定它現在該去哪。**
一個代號 = 一課的一輪的一個小節；代號永不變，目的地隨時可改。

---

## 1. 現在印到紙上的東西（全部驗證過，2026-08-24）

QR 的值只有一行程式決定：

```ts
// frontend/src/components/qr/lessonQr.ts
buildLessonQrValue(origin, lessonId, step) => `${origin}/learn/${lessonId}/${step}`
```

呼叫它的地方傳的是 `window.location.origin` 與 `s.id`：

```ts
// frontend/src/pages/admin/lesson-audio/LessonAudioTable.tsx:313
const rows = buildQrManifestRows(sortedStories, window.location.origin);
```

於是**紙上同時焊死了四樣東西**，每一樣都已經咬過我們：

| # | 焊進去的 | 現況實測 | 已造成的後果 |
|---|---|---|---|
| A | `origin` | `window.location.origin` | **PM 在 staging 產 QR → 每一張都指向測試站**。學生掃進去用測試站登入，學習歷程留在測試站。這不是設定錯，是設計保證會發生 |
| B | 路徑 `/learn/.../{step}` | 前端路由名 | `full-reading` → `key-passage-reading` 已改名過一次，靠 `LEGACY_STEP_ID_ALIASES` 撐著。再改一次紙本就廢 |
| C | `lessonId` | `s.id` = 20011 | 那是**抽取流水號**不是課碼 |
| D | 「一課兩張」的假設 | `full_url` + `passage_url` 各一 | 一課多篇時不夠用（L0063 有三輪念順順） |

另外一個相鄰缺陷（同一張表，會污染要交出去的 Excel）：

| E | 後台排序與課號 | `sort((a,b)=>a.lesson_number-b.lesson_number)`、顯示 `L{lesson_number}` | 第一列是「十秒的背後 / L20001」，而圖書館第一課是「贏得喝采的輸家」（`lesson_seq` 4010）。**交出去的 Excel 課號對不上老師手上的紙本** |

---

## 2. 目標

1. 紙本印出去之後，目的地還能改（換網域、換路由、換頁面、報廢重指）
2. 一課多篇 → 每一篇各自有自己的全文 QR 與念順順 QR
3. 已經印出去的舊 QR **永久有效**，一張都不能廢
4. 交給教材端的 Excel，課號與順序跟紙本一致

## 非目標

- 不改已上架課文的內容
- 不做「一個 QR 掃出多篇讓人選」的頁面（一個 QR 就是一個明確目的地）
- 不追求 QR 代號可讀（它不是給人看的；可讀的是 Excel 那一欄）

---

## 3. 解法

### 3.1 紙上只有代號

```
印在紙上：  https://<固定 QR 入口網域>/q/{code}
code：      5 碼，字母表 34679acdefhjkmnpqrtuvwxy
            （排掉 0/O、1/l/I、2/Z、5/S、8/B、g/q —— 老師會從紙上手打）
```

`origin` **不再由前端組**。QR 入口網域是一個設定值，前端拿到什麼就印什麼，
不用 `window.location.origin`。在 staging 的後台按下載，印出來的仍是正式站的碼。

> ⚠️ 這一條是 A 的真正修法。只是「叫 PM 記得去 production 按」不算修 ——
> 那把一個系統性缺陷降級成人的紀律，下次還會再犯一次。

### 3.2 定址單位 = （課, 輪, 小節）

```
code → { lesson_uid, round, section, target }
```

- **單篇課**：`round` 只有一輪。一課兩個 code（全文、念順順），跟現在一樣
- **多文本課**：**每一輪各自一組**。L0063 三輪 → 全文×3 + 念順順×3 = **6 個 code**
- `round` 就是 #2916 那個 part slug（`4uee3` / `7wavn`）—— 不另外發明編號

`target` 是「現在該去哪」，是**可改的設定**：

```yaml
target:
  kind: step          # 目前只有這一種
  step: key-passage-reading
  part: 4uee3         # 多文本課才有；單篇課省略
```

要換頁面、換 step 名、把某一張報廢改指別處 —— 改這裡，紙本不動。

### 3.3 登記簿

`backend/data/qr_codes_registry.yml`，比照 `part_ids_registry.yml`：

```yaml
7k3mx:
  lesson_uid: L0063
  round: 4uee3
  section: key_reading
  label_snapshot: 第23課　政府可以干預價格嗎？（念順順）
  status: active
  target: { kind: step, step: key-passage-reading, part: 4uee3 }
```

三條規則（跟 part id 同一套，已有 gate）：

1. **退役的 code 永不重用** —— 舊紙本還在外面流通，重用等於把人送到別課
2. **code 全域唯一**，不是每課各自編號
3. **`label_snapshot` 只是給人看的快照**，不是識別依據

### 3.4 轉址

`GET /q/{code}` →
- 查到且 `status: active` → 302 到 `target` 解出來的路徑
- 查到但已退役 → 一頁「這張 QR 已停用」，**不要 404**（老師拿著紙本會慌）
- 查不到 → 同上，不要裸 404

⚠️ 未登入掃進來仍要看得到內容（`LearningRouteGate` → `GuestReadingPage`），
這是印在紙上的全部意義（#2649），轉址不可以把它擋掉。

### 3.5 舊 QR 永久有效

`/learn/{id}/{step}` **原封不動保留**，不加 deprecation、不改行為。
已經印出去的那些是外面流通的實體，沒有回收機制。

---

## 4. yml：沿用 #2916，不另外發明

第 2 輪起檔名帶 slug，同一個 slug ＝ 同一輪：

```
v3/
  key_reading.yml           第 1 輪
  key_reading.4uee3.yml     第 2 輪
  key_reading.7wavn.yml     第 3 輪
```

QR 的 `round` 就是那個 slug。**一個念順順對應一篇文章，一對一**，
所以 code 不需要交叉引用「哪一份課文」。

---

## 5. Excel 交付物（教材端真正拿到手的東西）

一列 = 一個 code（不是一列一課）：

| 欄 | 內容 | 為什麼 |
|---|---|---|
| 課號 | `G4-L01` | ⛔ 不是 `L20001`。用 `lesson_seq` / `lesson_no`，跟紙本一致 |
| 課名 | 贏得喝采的輸家 | |
| 篇次 | 1/1、2/3 | 單篇課填 1/1，不要留空 |
| 小節 | 全文朗讀 / 念順順 | 用老師看得懂的名字 |
| QR 網址 | `https://.../q/7k3mx` | |
| 代號 | `7k3mx` | 手打備援 |
| QR 圖 | PNG | |

**排序照 `lesson_seq`**，不是 `lesson_number`（缺陷 E）。

---

## 6. 為什麼不用其他做法

| 選項 | 為什麼不 |
|---|---|
| 只把 origin 改成硬寫 production | 只修 A。B/C/D 還在，下次改路由或加一篇又要重印 |
| 用 `/q/{lesson_uid}/{section}` 這種有語意的短址 | 語意就是承諾。`lesson_uid` 或 section 名一改，紙本又廢一次 |
| 一個 QR 掃出選單讓人選第幾篇 | 多一次點擊，而且老師的紙本上那個 QR 就印在某一篇旁邊，本來就沒有歧義 |
| 叫 PM 記得去 production 按下載 | 把系統缺陷換成人的紀律。這次就是這樣出事的 |

---

## 7. 分階段（今天要落地的是 1–4）

| # | 做什麼 | 產出 |
|---|---|---|
| 1 | 建 code 產生器 + 登記簿 + gate（唯一、不重用、每個 active code 指得到東西） | `qr_codes_registry.yml`、`scripts/build_qr_codes.py`、`test_qr_codes_2918.py` |
| 2 | `GET /q/{code}` 轉址（含退役頁、guest 可看） | backend route + 測試 |
| 3 | 前端改用 code，`origin` 改吃設定；後台排序/課號改 `lesson_seq` | `lessonQr.ts`、`LessonAudioTable.tsx` |
| 4 | Excel 一列一 code，欄位照 §5 | `buildQrManifestRows` 改寫 |
| 5 | 多文本課的每一輪產各自的音檔 | 之後 |

**驗收（缺一不可）**
- 在 **staging 後台**按下載，印出來的網址指向 **production**（缺陷 A 的直接反證）
- L0063 拿到 6 個 code，各自掃進去落在正確的那一輪
- 單篇課仍是 2 個 code，且**舊的 `/learn/{id}/{step}` 仍然可用**
- Excel 第一列是 `G4-L01 贏得喝采的輸家`，不是 `L20001 十秒的背後`
- 未登入掃 code 看得到內容、聽得到朗讀
