# meeting-prep

**觸發詞**：
- 開會準備 / 會議準備 / 建立議程 / 準備議程 / 準備會議資料 / 這週要開會
- meeting prep / build agenda / weekly meeting prep / prepare meeting / prepare agenda
- 週五開會 / Friday meeting（向後相容，但**不假設**日期一定是週五）

**重要原則：不假設會議日期。** 沒有指定日期 → 必問。

**用途**：自動查詢本週 PR/issue 數據，產出 4 份文件（議程 + 貢獻紀錄 + 靖杭 JSON + 啟翔 JSON），開 PR 到 staging，等 Young admin merge

**參考 PR**：#1483（merged 2026-05-07）是這個 skill 第一次跑的完整範例

---

## 執行前提

- 在 `chinese-literacy-platform` 主 repo 根目錄
- `gh` CLI 已登入（`gh auth status`）
- `git` worktree 乾淨（`git worktree list` 無衝突）

---

## Step 0：確認會議日期

**這個 step 是強制的。不能跳過。不能假設日期。**

### 0a. 嘗試從 user 訊息 parse 日期

常見格式：
- 明確日期：「5/9 開會」「2026-05-09」→ 直接 parse
- 相對日期：「明天」「後天」→ 用 `date` 計算
- 星期描述：「下週一」「這週四」「週三」→ 用 `date` 計算
- 觸發詞含「週五」「Friday」→ 算下個（或本週）Friday，但**仍需告知 user 並確認**

### 0b. 如果 user 沒指定日期

**必須問，不能猜。** 用以下格式詢問（用 AskUserQuestion tool）：

> 會議日期是哪天？
> （如果不確定，預設下個工作日是 {next_workday}）

讓 user 填入或確認後再繼續。

### 0c. 計算週區間

確認 `MEETING_DATE` 後，計算查 PR 用的週 Mon 起點（查「這次會議涵蓋的這一週」）：

```bash
# MEETING_DATE 格式：YYYY-MM-DD（由 user 確認或 parse 取得）
MEETING_DATE="2026-05-09"   # ← 替換成實際日期

# 當週星期幾（1=Mon … 7=Sun）
MEETING_DOW=$(date -j -f "%Y-%m-%d" "$MEETING_DATE" +%u 2>/dev/null \
  || date -d "$MEETING_DATE" +%u)

# 會議是星期幾（中文標籤），cover 週一到週日
case "$MEETING_DOW" in
  1) DOW_ZH="一" ;;
  2) DOW_ZH="二" ;;
  3) DOW_ZH="三" ;;
  4) DOW_ZH="四" ;;
  5) DOW_ZH="五" ;;
  6) DOW_ZH="六" ;;
  7) DOW_ZH="日" ;;
esac

# 本週 Mon（查 PR 用）
DAYS_SINCE_MON=$((MEETING_DOW - 1))
MON=$(date -j -v-${DAYS_SINCE_MON}d -f "%Y-%m-%d" "$MEETING_DATE" +%Y-%m-%d 2>/dev/null \
  || date -d "$MEETING_DATE -${DAYS_SINCE_MON} days" +%Y-%m-%d)

# 週區間標籤，例如 5/5~5/9
MON_LABEL=$(date -j -v-${DAYS_SINCE_MON}d -f "%Y-%m-%d" "$MEETING_DATE" +%-m/%-d 2>/dev/null \
  || date -d "$MEETING_DATE -${DAYS_SINCE_MON} days" +%-m/%-d)
MEETING_DATE_LABEL=$(date -j -f "%Y-%m-%d" "$MEETING_DATE" +%-m/%-d 2>/dev/null \
  || date -d "$MEETING_DATE" +%-m/%-d)
WEEK_LABEL="${MON_LABEL}~${MEETING_DATE_LABEL}"

echo "Meeting: $MEETING_DATE（週${DOW_ZH}）| Week: $WEEK_LABEL | Mon (PR search from): $MON"
```

macOS 用 `date -j -f`，Linux 用 `date -d`。上面已同時相容。

---

## Step 1：查詢本週數據

### 1a. Merged PRs（本週）

```bash
gh pr list \
  --repo Youngger9765/chinese-literacy-platform \
  --state merged \
  --search "merged:>=${MON}" \
  --json number,title,author,mergedAt,body \
  --limit 50
```

重點欄位：
- `number` — PR#
- `title` — 顯示在 contributions 表
- `author.login` — 對應 `if-else-master`（靖杭）/ `stgst`（啟翔）/ `Youngger9765`（Young）
- `mergedAt` — 確認是本週

### 1b. Open PRs（議程用）

```bash
gh pr list \
  --repo Youngger9765/chinese-literacy-platform \
  --state open \
  --json number,title,author,labels \
  --limit 30
```

### 1c. Open Issues（議程待討論）

```bash
# 7/1 deadline 相關
gh issue list \
  --repo Youngger9765/chinese-literacy-platform \
  --state open \
  --label "7/1-deadline" \
  --json number,title,assignees,labels 2>/dev/null

# 所有 open（作 priority 分析用）
gh issue list \
  --repo Youngger9765/chinese-literacy-platform \
  --state open \
  --json number,title,assignees,labels \
  --limit 50
```

### 1d. 讀取 intern JSON 現狀

```bash
cat docs/intern-training/interns/raymond.json | jq '{lastReview,skills_summary: (.skills | to_entries | map({(.key): .value.level}) | add)}'
cat docs/intern-training/interns/xiung.json   | jq '{lastReview,skills_summary: (.skills | to_entries | map({(.key): .value.level}) | add)}'
```

### 1e. 最近 agenda 範本

```bash
ls docs/meetings/*-agenda.md | sort | tail -1
```

---

## Step 2：建立 worktree + branch

```bash
ISSUE_NUM=<已開的 issue number>   # 替換為實際 issue#
BRANCH="feat/issue-${ISSUE_NUM}-meeting-prep-${MEETING_DATE}"

git worktree add ../chinese-literacy-platform-issue-${ISSUE_NUM} \
  -b "$BRANCH" staging

cd ../chinese-literacy-platform-issue-${ISSUE_NUM}
```

---

## Step 3：產出 4 份文件

### 3a. 議程：docs/meetings/{MEETING_DATE}-agenda.md

依以下模板填入，**用 Step 1 數據填寫，不要虛構**：

```markdown
# 會議議程 {MEETING_DATE}（{DOW_ZH}）

## 參與者
- Young（lead dev）
- 靖杭 @if-else-master（intern）
- 啟翔 @stgst（intern）

---

## 一、本週重點工作（merged PRs）

### Young
| PR | 項目 | 說明 |
|----|------|------|
| #{N} | {title} | {1 sentence from PR body summary} |

### 靖杭
| PR | 項目 | 說明 |
|----|------|------|
| #{N} | {title} | {1 sentence} |

### 啟翔
| PR | 項目 | 說明 |
|----|------|------|
| #{N} | {title} | {1 sentence} |

---

## 二、7/1 Deadline 風險評估

| Issue | 標題 | Assignee | 狀態 | 風險 |
|-------|------|----------|------|------|
| #{N} | {title} | {assignee or 無人} | {open/in progress} | 🔴/🟡/🟢 |

風險標準：
- 🔴 無 assignee 或 PR 未開 且 deadline < 4 週
- 🟡 有 PR 但 CI 失敗 / review 中
- 🟢 PR merged 或 issue closed

---

## 三、待討論議題

1. **{Issue 或 topic}** — {1 句背景描述}
   - 目標：{本次討論要決定什麼}

2. **{Issue 或 topic}** — {1 句}
   - 目標：{決定點}

---

## 四、5/1 專家會議驗收狀態（若仍在追蹤期）

| Issue | 功能 | Assignee | 驗收狀態 |
|-------|------|----------|---------|
| #{N} | {title} | {name} | ✅ 通過 / 🔧 待確認 / ❌ 未完成 |

---

## 五、實習生進度快照

### 靖杭
- 本週 merged：{PR list}
- Open PRs：{PR list or 無}
- 下週建議聚焦：{1 item}

### 啟翔
- 本週 merged：{PR list}
- Open PRs：{PR list or 無}
- 下週建議聚焦：{1 item}

---

## 六、其他

- {任何臨時提案 / 通知}

---

## 七、Action Items

| # | 項目 | Owner | 截止日 |
|---|------|-------|-------|
| 1 | {item} | {Young/靖杭/啟翔/方大哥} | {YYYY-MM-DD} |
```

**空白 section 規則**：若某 section 本週無對應資料（例如 5/1 驗收已過 2 個月），整個 section 省略不寫，不要留空表格。

---

### 3b. 貢獻紀錄：docs/meetings/team-contributions.md

在 `---`（第一個橫線）之後、最近一週區段之前，插入新的週區段：

```markdown
## {MON_LABEL} ~ {MEETING_DATE_LABEL}

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | PR #{N} {short-title} | {做了什麼，1-2 句，中文不加句號} |
| 靖杭 | ✅ | PR #{N} {short-title} (#{issue}) | {做了什麼} |
| 啟翔 | ✅ | PR #{N} {short-title} (#{issue}) | {做了什麼} |

---
```

**狀態符號**：
- `✅` — PR merged to staging
- `🔧` — PR open / review 中
- `❌` — 放棄 / 撤銷

**short-title**：取 PR title 去掉 `fix:`/`feat:` prefix，保留核心詞，20 字以內

**issue# 格式**：若 PR title 或 body 含 `Fixes #N` / `Related to #N` 就寫 `(#{N})`；找不到就省略括號

---

### 3c & 3d. 實習生技能樹：raymond.json + xiung.json

**兩個 intern 都要更新，不能只更新一個。**

更新規則：

**1. 必更新欄位**
```json
{
  "lastReview": "{MEETING_DATE}",
  ...
}
```

**2. history entries（每個 merged PR 加一條）**

在對應的 skill ID 的 `history` array 末尾 append：
```json
{
  "date": "{MEETING_DATE}",
  "level": <new_level_or_same>,
  "reason": "PR #{N} — {具體 evidence，例如：first time designed API endpoint schema independently, demonstrated understanding of FK cascade}"
}
```

**3. skill bump 規則（evidence-based，禁止 fabrication）**

| 條件 | 是否 bump | 說明 |
|------|----------|------|
| PR diff 小（< 50 lines），簡單 bug fix | 不 bump | 維持現有 level，history reason 記錄 what was done |
| PR 首次獨立完成某類型任務（API design / backend route / complex state management）| bump +1 | reason 寫「first time」+ 具體技術名稱 |
| PR 已有多次同類 pattern，quality 穩定 | bump +1 | reason 寫「consistent pattern」+ 引用 PR# |
| PR 靠大量 Claude review round（> 3 輪）才過 | 謹慎 bump | 寫明 review rounds，判斷是否真獨立 |
| 本週無 merged PR | 不 bump，不加 history entry | lastReview 仍更新 |

**禁止**：
- 不要寫「本週表現良好」這類空洞理由
- 不要 bump > +1（一次最多一級）
- 不要 bump 到 maxLevel 以上
- 不要根據 PR title 猜技術難度，要看 diff 規模 + review 輪數

**skill ID 對應技能**（raymond.json 有 1~18+，xiung.json 結構類似）：

| ID | 技能 |
|----|------|
| 1  | Git 操作 |
| 2  | HTML 語意 |
| 3  | JS 基礎 |
| 4  | 本地開發環境 |
| 5  | React 元件閱讀 |
| 6  | React 元件開發 |
| 7  | TypeScript |
| 8  | State management |
| 9  | API 串接 |
| 10 | CSS / Tailwind |
| 11 | useEffect / useRef / hooks |
| 12 | 測試撰寫 |
| 13 | Code review 回應 |
| 14 | 問題拆解能力 |
| 15 | 溝通能力 |
| 16 | DB schema 理解 |
| 17 | 後端 Python 閱讀 |
| 18 | 後端 API 設計 |

新增 skill ID（需要時）：在 `skills` object 新增對應 key，初始 level 1。

---

## Step 4：Commit + Push + PR

```bash
cd ../chinese-literacy-platform-issue-${ISSUE_NUM}

git add \
  docs/meetings/${MEETING_DATE}-agenda.md \
  docs/meetings/team-contributions.md \
  docs/intern-training/interns/raymond.json \
  docs/intern-training/interns/xiung.json

git commit -m "docs(meeting): ${MEETING_DATE} agenda + contributions + skill trees (Related to #${ISSUE_NUM})"

git push -u origin "$BRANCH"
```

**驗證 JSON 格式（push 前必跑）**：
```bash
jq . docs/intern-training/interns/raymond.json > /dev/null && echo "raymond.json OK"
jq . docs/intern-training/interns/xiung.json   > /dev/null && echo "xiung.json OK"
```

若 `jq` 報 parse error，先修再 push。

---

## Step 5：開 PR + CI watch

```bash
gh pr create \
  --base staging \
  --head "$BRANCH" \
  --title "docs(meeting): ${MEETING_DATE} agenda + team contributions + intern skill trees (Fixes #${ISSUE_NUM})" \
  --body "$(cat <<'EOF'
## Summary

- Add `docs/meetings/{MEETING_DATE}-agenda.md` — agenda with 7/1 deadline risk table, action items
- Update `docs/meetings/team-contributions.md` — prepend {WEEK_LABEL} week section
- Update `docs/intern-training/interns/raymond.json` — lastReview + history entries + skill bumps (if evidence)
- Update `docs/intern-training/interns/xiung.json` — lastReview + history entries + skill bumps (if evidence)

## Key agenda items

- {bullet 1 from agenda section 二/三}
- {bullet 2}
- {bullet 3}

## Test plan

- [ ] `docs/meetings/{MEETING_DATE}-agenda.md` renders correctly in GitHub preview
- [ ] `team-contributions.md` new week section at top (after header, before last week)
- [ ] `raymond.json` valid JSON — `jq . raymond.json` passes
- [ ] `xiung.json` valid JSON — `jq . xiung.json` passes
EOF
)"
```

然後等 CI：
```bash
RUN_ID=$(gh run list --repo Youngger9765/chinese-literacy-platform \
  --branch "$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

CI 通常只跑 lint/build（無後端 deploy），約 2-5 分鐘。

**不要自動 merge** — 等 Young admin merge。

---

## Step 6：回報 summary

完成後輸出：

```
Issue #${ISSUE_NUM} / PR #{PR_NUM} 已開

4 份文件：
- docs/meetings/${MEETING_DATE}-agenda.md（新增）
- docs/meetings/team-contributions.md（${WEEK_LABEL} 週區段插入）
- docs/intern-training/interns/raymond.json（lastReview ${MEETING_DATE}）
- docs/intern-training/interns/xiung.json（lastReview ${MEETING_DATE}）

議程重點：{1 句總結本週最重要的議題}

請 Young 確認後 merge。
```

---

## Step 7：Cleanup（merge 後 or PR 放棄後）

```bash
# 在主 repo 目錄執行
cd /Users/young/project/chinese-literacy-platform

git worktree remove ../chinese-literacy-platform-issue-${ISSUE_NUM} --force
git branch -D "$BRANCH" 2>/dev/null || true
echo "Worktree cleanup complete"
```

Remote branch 會被 CI cleanup job 自動刪除。

---

## 常見問題

**Q: user 只說「週五開會」但沒給日期，要怎麼處理？**
A: 算出下個（或本週）Friday 日期，然後用 AskUserQuestion **告知** user 預設日期並請確認：「我算出下個週五是 {date}，請確認這是正確的會議日期？」確認後再繼續

**Q: 靖杭或啟翔本週沒有 merged PR？**
A: 仍更新 `lastReview`，history 不加新 entry，contributions 表可以省略該人或標 `⏳ 本週無 PR`

**Q: 今天就是開會日，還有什麼特別處理嗎？**
A: 無特殊處理。`MEETING_DATE` = 今天，照一般流程跑即可

**Q: 開會是週六或週日？**
A: 完全支援。`DOW_ZH` case 涵蓋 1~7（週一到週日）。`MEETING_DATE` 就是週六/日的日期，`MON` 往回算到當週週一

**Q: Step 1c open issues 有很多，怎麼決定放哪些進議程？**
A: 優先順序：
1. `7/1-deadline` label 的 — 全放，加風險標色
2. 無 assignee + open > 2 週 — 放「待討論」section
3. 靖杭/啟翔 open PR > 5 天未更新 — 放「實習生進度」section

**Q: 議程 section 本週無資料要怎麼處理？**
A: 整個 section 省略，不留空表格（避免「本週無議題」類的 filler text）

---

## 範例觸發語句

- 「週五開會，幫我準備議程」（→ 算下週五，但**仍確認日期**）
- 「這週一要開會，準備一下」（→ parse 下週一或本週一）
- 「5/9 要開會，建立議程」（→ 直接用 2026-05-09）
- 「下週三開會的資料先準備好」（→ 算下週三日期）
- 「準備會議資料」（→ 沒日期，必問）
- 「建立議程」（→ 沒日期，必問）
- 「meeting prep」（→ 沒日期，必問）
- 「weekly meeting prep for Monday」（→ 算下週一）
- 「build agenda for 5/12」（→ 直接用 2026-05-12）
