# Gamified Learning Path UI Research — 教育類 App 學習路徑視覺設計調研

> LingoLeap 國語文閱讀學習平台 | 研究日期：2026-04-10
> 目的：為學習路徑 UI 設計提供競品分析與設計方向參考

---

## 一、競品學習路徑 UI 比較總表

| App | 路徑類型 | 進度指標 | 動畫/驚喜 | 目標感 | 好玩程度 | 技術推測 | 平台重心 |
|-----|---------|---------|-----------|--------|---------|---------|---------|
| **Duolingo** | 線性蛇形路徑（zigzag nodes） | 皇冠等級、XP、連續天數火焰 | 角色慶祝動畫、XP 噴射、完課煙火 | ★★★★★ 極強，一條路走到底 | ★★★★☆ | React + Tailwind + SVG nodes | Mobile-first |
| **Khan Academy** | 章節式技能格（grid squares） | 精熟度色塊（Familiar→Proficient→Mastered） | 色塊填滿動畫、閃電/星星圖示 | ★★★★☆ 結構清晰 | ★★★☆☆ 偏學術 | React (Wonder Blocks 設計系統) | Web-first |
| **Prodigy Math** | RPG 世界地圖 + 怪物戰鬥 | 等級、寶石、寵物收集 | 戰鬥動畫、升級特效、寵物進化 | ★★★☆☆ 遊戲導向 | ★★★★★ 超好玩 | Unity WebGL / Canvas | Cross-platform |
| **Epic!** | 書架式瀏覽 + 成就牆 | 閱讀徽章、等級、頭像框 | 徽章解鎖動畫、等級提升慶祝 | ★★★☆☆ 閱讀里程碑 | ★★★☆☆ | Native iOS/Android | Mobile-first |
| **Memrise** | 太空主題垂直上升路徑 | 點數、植物生長、太空船升級 | 太空船發射、星球解鎖 | ★★★☆☆ 上升=進步 | ★★★☆☆ | Native + Web (React) | Mobile-first |
| **Brilliant.org** | 色彩分類學習路徑（Rive 節點） | XP、連續天數、課程完成度 | Rive 向量動畫慶祝、節點色彩變化 | ★★★★★ 路徑清晰 | ★★★★☆ | React + **Rive** animations | Mobile + Web |
| **ABCmouse** | 生態區域世界地圖（biomes） | 頭像移動、旗幟標記、寶箱獎勵 | 寶箱開啟、隱藏彩蛋、頭像裝扮 | ★★★★☆ 冒險感 | ★★★★☆ 小小孩超愛 | Canvas / WebView | Tablet-first |
| **Roblox Education** | 3D 虛擬世界自由探索 | 排行榜、自訂角色裝備 | 3D 互動動畫、即時物理效果 | ★★☆☆☆ 太自由 | ★★★★★ | Luau (Lua) + Roblox Engine | Cross-platform |
| **ClassDojo** | 無路徑（行為點數面板） | 怪物頭像點數、行為統計 | 點數跳動動畫、怪物表情變化 | ★★☆☆☆ 非學習路徑 | ★★★☆☆ | React Native | Mobile-first |
| **數位讀寫網** | 三層級分段式（PP→DP→EP） | 無遊戲化，純完成記錄 | 無動畫 | ★★☆☆☆ 結構有但無趣 | ★☆☆☆☆ | ASP.NET 傳統 Web | Web-only |

---

## 二、五種學習路徑 UI 模式深度分析

### 模式 A：Node-based Linear Path（Duolingo 式蛇形節點路徑）

**視覺特徵**
- 圓形節點沿畫面中軸左右交替排列（zigzag 蛇行）
- 節點之間用曲線或直線連接
- 當前節點放大 + 發光 + bounce 動畫
- 已完成節點顯示皇冠/星星
- 未解鎖節點灰色 + 鎖頭圖示
- 整體畫面垂直滾動

**優點**
- 極強的方向感：永遠知道「下一步做什麼」
- 減少選擇焦慮（paradox of choice）
- 適合移動端單手操作
- 節點狀態（locked/current/done）一目了然

**缺點**
- 用戶自主性低（2025 年用戶反彈：「不讓我自由練習」）
- 難以表達非線性學習關係（如：生字練習和朗讀可以平行做）

**技術實作**
- 節點定位：CSS flexbox/grid + transform offset（奇偶列 translateX 正負值）
- 連接線：SVG `<path>` 或 CSS border + 偽元素
- 動畫：CSS keyframes（bounce, glow） + Framer Motion
- 進度存取：Zustand / React Context
- 參考實作：[react-duolingo](https://github.com/bryanjenningz/react-duolingo) (React + TypeScript + Next.js + Tailwind)

**適合 LingoLeap 程度：★★★★☆**
與我們 10 步驟線性流程高度契合。可直接對應 STEP_CONFIG 的步驟順序

---

### 模式 B：World Map with Regions（RPG 世界地圖）

**視覺特徵**
- 鳥瞰視角的卡通地圖
- 不同學習主題 = 不同地形區域（森林=閱讀、山洞=生字、海洋=理解）
- 玩家頭像在地圖上移動
- 路徑用虛線/小路標示
- 區域解鎖有 fog-of-war 效果

**典型代表**
- Prodigy Math：多個區域，每個有不同怪物和數學主題
- ABCmouse：10 級地圖，每級是一個生態區（叢林、沙漠等）
- 寶箱在路徑終點，隱藏彩蛋散佈在背景中

**優點**
- 冒險感和探索慾強
- 視覺豐富，適合低齡學童
- 可以自然地分組不同學科/主題

**缺點**
- 開發成本高（需大量插畫素材）
- 地圖尺寸在手機上難操作
- 容易讓學生分心在探索而非學習

**技術實作**
- 地圖底圖：大型 SVG 或分層 PNG + CSS parallax
- 節點定位：absolute positioning on map coordinates
- 縮放/平移：CSS transform + touch events / react-zoom-pan-pinch
- 動畫：Lottie / Rive for character movement
- 複雜度高，需設計師深度參與

**適合 LingoLeap 程度：★★★☆☆**
視覺效果好但開發成本高。可作為長期目標，短期用簡化版（地圖背景 + 路徑節點）

---

### 模式 C：Skill Tree Branching（技能樹分支）

**視覺特徵**
- 樹狀結構，從根部向上/向外分支
- 節點之間有前置條件關係（prerequisite edges）
- 可同時解鎖多個平行分支
- 每個節點有技能等級（1-5 星或 bronze→silver→gold）

**典型代表**
- RPG 遊戲天賦樹（WoW, Path of Exile）
- [beautiful-skill-tree](https://github.com/andrico1234/beautiful-skill-tree)：React 專用技能樹元件

**優點**
- 能表達複雜的學習前置關係
- 給予學生自主選擇路線的自由
- 「解鎖新技能」的成就感極強

**缺點**
- 對國小學生過於複雜
- 資訊密度太高，容易迷路
- 需要大量學習內容才能撐起分支

**技術實作**
- npm: `beautiful-skill-tree`（React 元件，自動排版，鍵盤無障礙）
- 自建：ReactFlow / D3.js force-directed graph
- 節點連線：SVG path with arrow markers
- 資料結構：adjacency list with prerequisite edges

**適合 LingoLeap 程度：★★☆☆☆**
對國小高年級～國中生太複雜。不建議作為主要路徑，但可用於「成就/技能總覽」頁面

---

### 模式 D：Linear Chapter Progression（線性章節書本式）

**視覺特徵**
- 類似書本目錄或章節列表
- 每個章節有進度條（0%→100%）
- 已完成打勾 ✓，進行中高亮
- 章節內有子任務清單

**典型代表**
- Khan Academy：Course → Unit → Lesson 三層結構
- 精熟度用色塊矩陣視覺化（每個技能一個小方塊，顏色 = 精熟等級）
- Coursera：線性課程 + 週次結構

**優點**
- 結構最清楚，教師/家長好理解
- 開發最簡單（基本 HTML/CSS list）
- 適合正式學科課程

**缺點**
- 最無趣的視覺表現
- 缺少遊戲感和驚喜
- 容易讓學生覺得是「又一個作業系統」

**技術實作**
- 純 HTML/CSS：accordion + progress bar
- React：shadcn/ui Accordion + Progress 元件
- 無特殊圖形庫依賴

**適合 LingoLeap 程度：★★★☆☆**
可作為教師端/家長端的「課程管理」視圖，但學生端需要更有趣的包裝

---

### 模式 E：Island/Continent Exploration（島嶼探索冒險式）

**視覺特徵**
- 每個學習單元 = 一座島嶼
- 島嶼之間用橋或船連接
- 島嶼內有多個學習點
- 整體像一張海賊/冒險地圖

**典型代表**
- ABCmouse 的生態區域概念
- 許多獨立教育遊戲採用

**優點**
- 「探索新島嶼」= 天然的學習動機
- 每座島嶼可以有獨立主題和視覺風格
- 適合「每篇課文 = 一座島」的概念

**缺點**
- 島嶼數量多時地圖擁擠
- 需要大量美術素材
- 縮放/導航在手機上有挑戰

**適合 LingoLeap 程度：★★★★☆**
「每篇課文 = 一座島嶼，島上 10 個學習點」概念很適合 LingoLeap。中期可考慮

---

## 三、關鍵設計洞察

### 3.1 最有效的進度指標（按 engagement 排名）

| 排名 | 指標 | 為什麼有效 | 代表 App |
|------|------|-----------|---------|
| 1 | **連續天數 (Streak)** | Loss Aversion（怕斷掉） | Duolingo, Brilliant |
| 2 | **XP + 等級** | 數字持續增長的成就感 | Duolingo, Khan Academy |
| 3 | **可收集的徽章/頭像** | Ownership（擁有感） | Epic!, ClassDojo, ABCmouse |
| 4 | **視覺進度（路徑/地圖）** | 看得到「走了多遠」 | Duolingo, ABCmouse |
| 5 | **排行榜** | Social Influence（社交比較） | Duolingo Leagues |

### 3.2 動畫與驚喜（Delight Moments）的最佳實踐

**必備動畫**（成本低，效果高）：
1. **完成任務 → 紙花/星星噴射** — 0.5 秒，CSS + Canvas particles
2. **升級/解鎖 → 光芒擴散 + 數字跳動** — Framer Motion spring animation
3. **連續答對 → combo 計數 + 火焰特效** — CSS gradient animation
4. **開始學習 → 角色打招呼** — Lottie/Rive 預製動畫
5. **Streak 維持 → 火焰圖示搖晃** — CSS wiggle keyframe

**Brilliant.org 的 Rive 案例**
- 每個學習路徑節點和連接線都是 Rive 動畫
- 檔案大小遠小於 GIF/影片
- 設計師可獨立更新動畫，不需開發者介入
- 狀態機驅動：idle → hover → active → complete

**要避免的**：
- 過長的慶祝動畫（>2 秒學生會不耐煩）
- 懲罰性的失敗動畫（紅色 X、難聽的 buzzer）— 改用「soft whoops」和鼓勵語
- 全螢幕強制觀看的動畫（讓學生可以 tap to skip）

### 3.3 年齡層設計差異（LingoLeap 目標：國小高年級～國中）

| 設計面向 | 6-8 歲 | 9-12 歲（LingoLeap 主力）| 13+ 歲 |
|---------|--------|----------------------|--------|
| 觸控目標 | 60-80pt | 50-60pt | 44pt+ |
| 配色 | 明亮主色 | **避免太幼稚的純色，用現代感配色** | 暗色模式可選 |
| 文字依賴 | 幾乎無，靠圖示 | 圖示 + 短文字 | 可全文字 |
| 動畫風格 | 超誇張、頻繁 | **適度誇張、獎勵時觸發** | 低調、不干擾 |
| 自主性 | 極低，全引導 | **中等，有選擇但有建議路線** | 高自主 |
| 社交元素 | 無 | **班級排行榜、同學頭像** | 全面社交 |
| 角色設計 | Q版圓潤 | **酷一點但仍友善** | 寫實/極簡 |

> **關鍵發現**：9-12 歲兒童（tweens）是「aspirational users」— 他們想要看起來「比自己年紀大一點」的設計。用 Discord/Roblox 的視覺語言，不要用「幼兒園風格」

### 3.4 Octalysis 動機框架在教育 App 的應用

根據 Yu-kai Chou 的分析，最成功的教育 App 同時觸發以下核心驅動力：

| Core Drive | 教育 App 最佳實踐 | LingoLeap 對應 |
|-----------|-------------------|---------------|
| CD2 成就感 | XP、精熟度、等級提升 | 已有 XP + 成就系統 |
| CD3 創造力 | 頭像自訂、學習路線選擇 | 可加：頭像系統 |
| CD4 擁有感 | 收集徽章、維護 streak | 已有 Streak + Badge |
| CD5 社交影響 | 排行榜、班級比較 | 已有 Leaderboard |
| CD7 不可預測 | 隱藏彩蛋、隨機獎勵 | 可加：學習路徑驚喜獎勵 |
| CD8 損失迴避 | Streak 斷掉的恐懼 | 已有 StreakBadge |

> 最重要的洞察：「成功的教育 App 解決的是動機問題，不是教學問題」

---

## 四、技術實作建議（對應 LingoLeap 技術棧）

### 現有技術棧
- React 19 + Vite + Tailwind
- 已有 gamification 元件：XPBar, StreakBadge, Leaderboard, BadgeGrid, XPAwardToast
- 10 步驟學習流程（STEP_CONFIG）
- 4 個步驟分類（reading/comprehension/practice/report）

### 推薦方案：混合模式（A + E 簡化版）

**Phase 1 — Duolingo 式蛇形路徑（2-3 週）**

核心元件：`<LearningPathView />`
```
技術方案：
- 節點：Tailwind 圓形 div + 條件樣式（locked/active/done）
- 連接線：SVG <path> overlay，用 cubic bezier 畫曲線
- Zigzag 排列：CSS grid + transform translateX(±offset)
- 動畫：Framer Motion（bounce, spring, stagger）
- 進度狀態：從現有 LearningSession API 讀取
```

每個節點映射到 STEP_CONFIG 的一個步驟：
- 🟠 讀全文做記號 → 🟠 逐段朗讀 → 🟠 全文朗讀（閱讀組，橘色）
- 🔵 生字練習 → 🔵 詞語定義 → 🔵 語詞應用 → 🔵 語詞複習（練習組，藍色）
- 🟢 課文理解 → 🟢 知識補給站（理解組，綠色）
- 🟣 報告（報告組，紫色）

**Phase 2 — 島嶼包裝（4-6 週）**

每篇課文 = 一座島嶼（SVG 插畫），島嶼內用 Phase 1 的節點路徑：
```
故事選擇 = 航海地圖，選一座島嶼
進入島嶼 = 展開 10 步驟蛇形路徑
完成島嶼 = 插旗 + 收集獎章
```

### 動畫技術選型

| 選項 | 優點 | 缺點 | 推薦度 |
|------|------|------|--------|
| **Framer Motion** | 已是 React 生態主流，API 簡潔 | 包大小 ~30KB | ★★★★★ 首選 |
| **Rive** | Brilliant.org 驗證過，超小檔案 | 學習曲線，需設計師配合 | ★★★★☆ 長期 |
| **Lottie** | After Effects 動畫直接用 | 檔案較大，不支援互動 | ★★★☆☆ |
| **CSS keyframes** | 零依賴 | 複雜動畫難維護 | ★★★☆☆ 輔助 |
| **Canvas particles** | 慶祝粒子效果最佳 | 需手寫或用 tsparticles | ★★★☆☆ 慶祝用 |

### React 可用元件/庫

| 庫 | 用途 | npm |
|---|------|-----|
| `beautiful-skill-tree` | 技能樹（成就頁可用） | `beautiful-skill-tree` |
| `framer-motion` | 路徑節點動畫 | `framer-motion` |
| `@rive-app/react-canvas` | Rive 動畫整合 | `@rive-app/react-canvas` |
| `tsparticles` | 完成慶祝紙花效果 | `@tsparticles/react` |
| `reactflow` | 複雜節點圖（備選） | `@xyflow/react` |

---

## 五、LingoLeap 設計建議總結

### 立即可做（低成本高效果）

1. **完成步驟 → 慶祝動畫**：用 Framer Motion + CSS particles，每完成一步有 0.5 秒紙花
2. **學習路徑視覺化**：把 StepperNav 改成蛇形路徑視圖（Phase 1）
3. **步驟節點狀態動畫**：current 節點 bounce + glow，done 節點 checkmark fade-in
4. **XP 獲得動畫**：數字 spring 動畫 + 從節點飛向 XP bar

### 中期規劃（需設計師）

5. **課文島嶼地圖**：每篇課文一座風格化島嶼
6. **Rive 動畫系統**：設計師產動畫，工程師整合（Brilliant 驗證過的方案）
7. **頭像自訂系統**：讓學生自訂形象（9-12 歲最愛的 Controlled Self-Expression）

### 不建議做

- 3D 世界（Roblox 式）— 開發成本極高，不符合閱讀學習的沉浸需求
- 複雜技能樹分支 — 國小生會迷路
- 全球公開排行榜 — 改用班級內排行（Social Proof without Social Pressure）

---

## 六、與數位讀寫網（競品）的差異化

數位讀寫網是台灣最直接的競品，但其設計完全沒有遊戲化元素：
- 純 ASP.NET 傳統網頁，無動畫
- PP/DP/EP 三層結構僅是分類，沒有進度視覺化
- 無 XP、徽章、排行榜等激勵機制
- 無頭像或個人化元素
- 介面設計停留在 2010 年代

**LingoLeap 的差異化優勢**：
即使只做 Phase 1（蛇形路徑 + 基礎動畫），就已經在視覺體驗上遠超數位讀寫網。結合已有的 XP/Streak/Badge/Leaderboard 系統，LingoLeap 在台灣國語文教育平台中將是遊戲化程度最高的

---

## Sources

- [Introducing the new Duolingo learning path](https://blog.duolingo.com/new-duolingo-home-screen-design/)
- [Duolingo - an in-depth UX and user onboarding breakdown](https://userguiding.com/blog/duolingo-onboarding-ux)
- [UI Change That Duolingo Users Are Asking For In 2025](https://duolingoguides.com/ui-change-that-duolingo-users-want/)
- [react-duolingo clone (React + TypeScript + Tailwind)](https://github.com/bryanjenningz/react-duolingo)
- [Duolingo Design System on Figma](https://www.figma.com/community/file/1460744749282136015/duolingo-design-system)
- [Khan Academy - New mastery progress visualization](https://support.khanacademy.org/hc/en-us/articles/18735142028045-Update-New-mastery-progress-visualization-on-Course-and-Unit-pages)
- [Wonder Blocks: Khan Academy's design system](https://www.designsystems.com/about-wonder-blocks-khan-academys-design-system-and-the-story-behind-it/)
- [Prodigy Math Game - Wikipedia](https://en.wikipedia.org/wiki/Prodigy_Math_Game)
- [Prodigy Math: The RPG That Sneaks Learning Into Screen Time](https://screenwiseapp.com/guides/prodigy-math)
- [How Brilliant.org motivates learners with Rive animations](https://rive.app/blog/how-brilliant-org-motivates-learners-with-rive-animations)
- [Brilliant.org x ustwo design case study](https://ustwo.com/work/brilliant/)
- [ABCmouse Learning Path Guide](https://www.abcmouse.com/learn/abcmouse/unlocking-early-learning-success-a-guide-to-abcmouses-learning-path/7966)
- [Getting Started with ABCmouse Learning Paths](https://support.abcmouse.com/hc/en-us/articles/34386400234263-Getting-Started-with-the-Learning-Paths-in-ABCmouse)
- [Memrise App - Space themed (UI Sources)](https://uisources.com/app/memrise)
- [ClassDojo - Complete Guide](https://www.edu.com/blog/classdojo-a-complete-guide-to-this-popular-classroom-management-tool)
- [Epic! - How achievements and badges work](https://support.getepic.com/hc/en-us/articles/205626365--How-do-achievements-and-badges-work)
- [Roblox Educational Experiences](https://about.roblox.com/educational-experiences)
- [數位讀寫網](https://eliteracy.twnread.org.tw/)
- [beautiful-skill-tree (React npm)](https://github.com/andrico1234/beautiful-skill-tree)
- [Designing Gameful Experiences for Education & Training (2026)](https://www.gamificationhub.org/designing-gameful-experiences-for-education-and-training/)
- [Best Gamification Education Apps — Octalysis Analysis (2026)](https://yukaichou.com/gamification-examples/top-10-education-gamification-examples/)
- [UX Design for Kids: The Ultimate Guide](https://gapsystudio.com/blog/ux-design-for-kids/)
- [UI/UX Design Tips for Child-Friendly Interfaces](https://www.aufaitux.com/blog/ui-ux-designing-for-children/)
- [Gamification in UI/UX 2025 (Medium)](https://medium.com/@almaxdesignagency/gamification-in-ui-ux-2025-slay-the-game-or-get-slapped-by-it-plus-clever-tricks-to-keep-em-36f86faeefe4)
- [eLearning Gamification in 2026 Design Guide](https://raccoongang.com/blog/designing-efficient-elearning-gamification/)
- [30 Gamification Statistics (2026)](https://www.engageli.com/blog/game-based-learning-statistics)
