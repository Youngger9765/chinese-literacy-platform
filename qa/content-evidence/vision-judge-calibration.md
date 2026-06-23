# Vision Judge — EDD 校準報告

> 多模態 vision judge(`scripts/spotlight_vision_judge.py`,gemini-2.5-flash @ us-central1)
> render 聚光燈/重點表頁截圖 → 判 faithful / cross_lesson / skeleton / figure_broken。
> EDD 守則:沒過硬門檻不准放出去跑全 152。本檔下半段(逐案)由 script 自動產出,上半段是人工 round 史 + 診斷。

## TL;DR(誠實結論)
- **judge 尚未通過硬門檻 → 不可放去跑全 152。** 最佳一輪 round3 = **11/14 (0.79)**,門檻 0.85。
- 但關鍵發現:**剩下 3 個 miss 沒有一個是 judge 邏輯壞掉** —— 2 個是 eval ground-truth 本身錯/過時,
  1 個是該課圖片本身糊到像破圖(邊界)。也就是**地基(eval 標籤)鬆了,不是 judge 不準**。
- judge 對「真缺陷」的偵測是穩的:cross_lesson 1/1、figure_broken 1/1(真『圖片載入失敗』框抓到)、
  9 個 faithful 全中、2 個 story-structure 全中。**這些跨 round2/round3 完全一致(可重現)。**
- 依 EDD + no-overfit 鐵律:**不調 prompt 硬湊那 3 個**(會把對的判成錯 / 變 overfit)。
  改成把 3 個爭議 case 標 `disputed:` 交人工定真相(見 eval yaml)。**達標與否的決定權留給 Young/coordinator。**

## Round 史
| round | 變更 | 準度 | 教訓 |
|---|---|---|---|
| round1 | 初版 prompt + viewport-only 截圖 | 中斷(跑到 case5 process 死、無報告) | Python block-buffer 吃掉 log + browser session 跨 render 不穩 → 改 `python -u` unbuffered;**原 --calibrate fail-open return 0 → 改硬門檻 non-zero exit** |
| round2 | + 工作示範例 carve-out(修 1098 背影誤判)+ full-page 截圖 + figure_broken 收緊 v1 + 硬門檻 + 平衡 eval(加 figure_broken/SS) | 10/14 | 浮現 4 miss:1024 / 1103 / 1132 / 1143 |
| round3 | + figure_broken 收緊 v2(「圖醜≠圖破」,只認載入失敗框) | **11/14** | 1143(通用插頭 clip-art)**修好轉 faithful**;1118 真破圖仍正確 HIT。剩 1024 / 1103 / 1132 |

## 3 個剩餘 miss 的根因(全部 round2+round3 一致、可重現)
1. **1024 reading-strategy(expect skeleton,judge=faithful conf 1)— eval 標籤是錯層**
   - skeleton 描述的是 base text(課文 paragraphs 純『一二三』),不是聚光燈 render 頁。
   - render 實看:聚光燈頁《成為身體的最佳夥伴》有完整句子 + 多題身體覺察練習 = 非骨架。
   - 架構結論:**skeleton 是資料/文字層缺陷,gate L1 `BASE_TEXT_QUALITY` 已抓**(全 matrix 只此 1 cell);
     render 的鷹架把它填成有內容 → 不該要 vision judge 從 render 認 skeleton。
   - 建議:此測項移回 L1 文字層,或換一個 render 真為骨架的 cell;**skeleton 不該是 vision judge 的 verdict**。
2. **1103 reading-strategy(expect faithful,judge=cross_lesson conf 1)— eval 標籤過時/本身模糊**
   - 2026-06-23 重查 staging API + render:title=最後一隻旅人鴿,但 spotlight 主體內嵌的練習課文是
     〈雨林裡的奇蹟藥物〉(箭毒),所有練習題問雨林/箭毒。**#2395「已修成旅人鴿」沒反映在 render**。
   - 本課策略=「跳過卡關詞先瀏覽」,**故意借另一篇(雨林)當練習文本**。judge 看「被分析主體是雨林不是旅人鴿」
     判 cross,**可辯護甚至可能正確**。需人工定:借他課文本當策略練習算 faithful 還是 cross?
3. **1132 reading-strategy(expect faithful,judge=figure_broken conf 0.9)— 該課圖糊到像破圖(邊界)**
   - 文字 judge 認同忠實;但頁面下方一張手指圖「模糊/像素化」,judge 讀成載入失敗/佔位。
   - 收緊 prompt(圖醜≠圖破)後仍 miss → 這張圖糊到 model 視為破圖。可能是**該課圖品質本身就是缺陷**。
   - 需人工定:這張糊圖算 faithful 還是該標 figure_broken(代表該課圖該換/重壓)?

## 結論
- **FAIL — 未達標,judge 還沒校準到位,不可放出去用**
- 整體準度:**11/14** (門檻 ≥ 85%)
- 未過門檻原因:
  - overall accuracy 11/14=0.79 < 0.85
  - defect class 'skeleton' recall 0/1 < 1.0（注:skeleton 應移回 L1 層,見上方診斷 1）

## 各類別 recall(defect class 必須 1.0)

| expected verdict | recall | 是否關鍵缺陷類 |
|---|---|---|
| cross_lesson | 1/1 | ✅ 關鍵 |
| faithful | 9/11 |  |
| figure_broken | 1/1 | ✅ 關鍵 |
| skeleton | 0/1 | ✅ 關鍵 |

## 逐案 expected vs got

| # | story | code | step | expected | got | hit | conf |
|---|---|---|---|---|---|---|---|
| 1 | 1020 | G4-L20 | reading-strategy | cross_lesson | **cross_lesson** | ✅ | 1 |
| 2 | 1024 | G4-L24 | reading-strategy | skeleton | **faithful** | ❌ | 1 |
| 3 | 1115 | G8-L4 | reading-strategy | faithful | **faithful** | ✅ | 1 |
| 4 | 1103 | G7-L31 | reading-strategy | faithful | **cross_lesson** | ❌ | 1 |
| 5 | 1098 | G7-L19 | reading-strategy | faithful | **faithful** | ✅ | 1 |
| 6 | 1015 | G4-L15 | reading-strategy | faithful | **faithful** | ✅ | 1 |
| 7 | 1132 | G9-L3 | reading-strategy | faithful | **figure_broken** | ❌ | 0.9 |
| 8 | 6 | G4-L13 | reading-strategy | faithful | **faithful** | ✅ | 1 |
| 9 | 1006 | G4-L6 | reading-strategy | faithful | **faithful** | ✅ | 0.9 |
| 10 | 1143 | G9-L14 | reading-strategy | faithful | **faithful** | ✅ | 1 |
| 11 | 22 | G6-L14 | reading-strategy | faithful | **faithful** | ✅ | 1 |
| 12 | 1118 | G8-L6b | reading-strategy | figure_broken | **figure_broken** | ✅ | 0.9 |
| 13 | 1115 | G8-L4 | story-structure | faithful | **faithful** | ✅ | 1 |
| 14 | 6 | G4-L13 | story-structure | faithful | **faithful** | ✅ | 1 |

## 逐案 reasoning(稽核用)

### 1. story 1020 G4-L20 reading-strategy — HIT
- expected: `cross_lesson` | got: `cross_lesson` | confidence: 1
- 標註理由(why expected): 聚光燈整段是『天才是練出來的』(費德勒/海菲茲練習),與本課供給/需求物價完全無關 = 張冠李戴
- judge reasoning: 截圖的內容主體在討論「天才」是透過後天練習而非天生，並舉例費德勒、海菲茲和莫札特等人物來佐證。這與本課課文《物以稀為貴：從「供給」和「需求」談物價波動》的主題完全無關，本課主要探討商品價格波動與供需關係。
- suspected_actual_lesson: 天才與努力/練習的重要性

### 2. story 1024 G4-L24 reading-strategy — MISS
- expected: `skeleton` | got: `faithful` | confidence: 1
- 標註理由(why expected): paragraphs 是純『一 二 三』標號無實質內文
- judge reasoning: 截圖內容為《成為身體的最佳夥伴》一課的「閱讀聚光燈」步驟。頁面引導學生透過觀察和練習來認識自己的身體，並提供多個關於身體習慣的選擇題，例如「雙手交叉」、「翹腳坐姿」等，這些都與課文主題「身體覺察與照護」高度相關。排版正常，內容完整。

### 3. story 1115 G8-L4 reading-strategy — HIT
- expected: `faithful` | got: `faithful` | confidence: 1
- 標註理由(why expected): 張冠李戴已修(玻璃娃娃內容對),假圖已清(prod figure block=0)
- judge reasoning: 截圖顯示的標題是「推論策略-推論人物行為的背後動機」，並明確提及「好心沒好報的玻璃娃娃爭議事件」作為練習文本。頁面中的題目「摔倒時，陳同學仍緊抱顏同學，將自己當成肉墊，保護著他。」直接引用了本課課文中的情節，要求學生推論人物動機。內容與本課課文完全一致，排版正常。

### 4. story 1103 G7-L31 reading-strategy — MISS
- expected: `faithful` | got: `cross_lesson` | confidence: 1
- 標註理由(why expected): 原雨林/箭毒已修成旅人鴿(staging 旅人鴿=True 箭毒=False)
- judge reasoning: 截圖中的閱讀文本內容為「亞馬遜雨林的原住民，會用藤蔓中提煉出的『箭毒』製作毒箭...」，這與本課《最後一隻旅人鴿》的主題「旅人鴿的滅絕」完全無關。頁面主體內容明顯是另一課的文本。
- suspected_actual_lesson: 雨林裡的奇蹟藥物

### 5. story 1098 G7-L19 reading-strategy — HIT
- expected: `faithful` | got: `faithful` | confidence: 1
- 標註理由(why expected): 聚光燈明寫『作者(朱自清)為什麼選擇寫背影』= 完全對應本課
- judge reasoning: 截圖內容明確指出本課讀書會討論主題是「作者(朱自清)為什麼選擇寫背影?」，並以「讀書會」為例說明詰問作者的步驟。雖然在舉例時提到「作者是林玫伶喔」，但這只是教學示範中的一個小插曲，頁面主體內容仍圍繞著「背影」這課的閱讀策略，因此判斷為 faithful。

### 6. story 1015 G4-L15 reading-strategy — HIT
- expected: `faithful` | got: `faithful` | confidence: 1
- 標註理由(why expected): 聚光燈講友情與愛情差異/互動判斷 = 對應本課(被舊 anti-cross 啟發式誤判)
- judge reasoning: 截圖內容為「閱讀聚光燈」步驟，標題明確指出是《感情小日記1——是友情還是愛情？》。頁面上的引導語和問題，如「小試身手」、「友情還是愛情呢？」以及「關於友情與愛情差異」等，都與本課主題「友情與愛情」高度相關。雖然圖片是通用圖示，但內容文字忠實於本課。

### 7. story 1132 G9-L3 reading-strategy — MISS
- expected: `faithful` | got: `figure_broken` | confidence: 0.9
- 標註理由(why expected): 聚光燈是『論據檢核』策略鷹架(通用引導語,合法),非張冠李戴(被舊啟發式誤判)
- judge reasoning: 截圖顯示頁面內容為「議論文結構-支持論點的論據」的教學鷹架，文字內容與本課主題「國高中數學課當然可以使用計算機！」相符，屬於通用教學策略。然而，頁面下方應顯示圖片的位置出現了明顯的模糊、像素化圖像，看起來像是載入失敗或佔位圖，因此判斷為破圖。

### 8. story 6 G4-L13 reading-strategy — HIT
- expected: `faithful` | got: `faithful` | confidence: 1
- 標註理由(why expected): 聚光燈講換位思考並點名阿公/小男孩/麵攤老闆(本課角色)= 對應本課(被舊啟發式誤判)
- judge reasoning: 截圖內容是關於「換位思考」的教學策略，並明確指出要應用此策略來推論「課文中阿公的想法」。這與本課《第一百碗麵》中阿公的角色和情節緊密相關，屬於忠實服務本課的教學鷹架。

### 9. story 1006 G4-L6 reading-strategy — HIT
- expected: `faithful` | got: `faithful` | confidence: 0.9
- 標註理由(why expected): 聚光燈講指稱詞/推論三步驟 = 本課主題(被舊啟發式誤判)
- judge reasoning: 截圖顯示的是「推論策略-推論代名詞」的教學內容，這是一個通用的閱讀策略鷹架。頁面提供了推論代名詞的三個步驟，並在「例如」部分舉了一個示範句：「雖然老師連假前派了一堆作業，但這對美美來說是小意思。」這個示範句與本課課文主題「意思」相關，且頁面下方有「需要時查看本課課文全文」的提示，表明這是針對本課的策略練習。內容和排版都正常，沒有破圖或空白骨架。

### 10. story 1143 G9-L14 reading-strategy — HIT
- expected: `faithful` | got: `faithful` | confidence: 1
- 標註理由(why expected): 聚光燈講倫敦人/心理韌性 = 本課(被舊啟發式誤判)
- judge reasoning: 截圖內容明確指出「課文中的倫敦人告訴我們一件事：心理韌性不是不會害怕...」，並列出三個學習之處，這些都與《焚而不毀的倫敦》這課的主題「心理韌性」高度相關。頁面中的情境舉例也引用了課文中的「沒打破我的茶壺」，證明內容忠實於本課。圖片雖然是通用圖示，但已成功載入，不影響內容的忠實性。

### 11. story 22 G6-L14 reading-strategy — HIT
- expected: `faithful` | got: `faithful` | confidence: 1
- 標註理由(why expected): 聚光燈『問出重要問題』策略鷹架(通用引導,合法)非張冠李戴(被舊啟發式誤判)
- judge reasoning: 截圖內容為「自我提問-問重要的問題」的閱讀策略教學，其中明確以本課「植物獵人-洪信介」為例，並列出多個與洪信介相關的問題作為練習題，例如「洪信介具備哪些成為植物獵人的條件？」、「洪信介最重要成就是什麼？」。頁面內容與本課課文主題高度相關，排版正常，無破圖。

### 12. story 1118 G8-L6b reading-strategy — HIT
- expected: `figure_broken` | got: `figure_broken` | confidence: 0.9
- 標註理由(why expected): 聚光燈內文忠實(推論策略-找出因果),但頁面中央有明顯『圖片載入失敗』佔位框 = figure_broken;這是文字層看不到、只有 render 截圖才抓得到的缺陷。gate matrix figure_blacklist_hit 命中(placeholder md5)
- judge reasoning: 截圖顯示頁面內容為「閱讀聚光燈」的「推論策略-找出一連串因果」，目標是推論本文的因果關係，並引導學生找出重要事件或現象。這些文字內容與本課《隱形的征服者》的主題相符，因為課文主要在探討西班牙人征服印加帝國的因果關係。然而，頁面中央有一個明顯的「圖片載入失敗」圖示，表示有圖片未能成功載入。

### 13. story 1115 G8-L4 story-structure — HIT
- expected: `faithful` | got: `faithful` | confidence: 1
- 標註理由(why expected): 左側參考課文=玻璃娃娃,右側文章重點表呈現玻璃娃娃事故概要/主要爭議 = 內容對應本課,排版正常無破圖
- judge reasoning: 截圖左側顯示了完整的課文內容，標題為《好心沒好報玻璃娃娃爭議事件》。右側的「文章重點表」區域，其標題、事故概要、主要爭議、法院判決等內容，都與左側課文的具體情節和討論主題完全吻合，沒有出現與其他課文相關的內容。排版正常，內容完整。

### 14. story 6 G4-L13 story-structure — HIT
- expected: `faithful` | got: `faithful` | confidence: 1
- 標註理由(why expected): 右側文章重點表要學生填本課情節(老人點最便宜的麵給孫子/寒流小男孩請阿公吃麵)= 忠實對應本課
- judge reasoning: 截圖左側顯示了完整的課文《第一百碗麵》，右側的「文章重點表」活動也完全圍繞這篇課文的內容設計，要求學生填寫課文的背景、起因、經過和結果，所有填空內容都直接取材於《第一百碗麵》的故事情節。排版正常，內容忠實於本課。
