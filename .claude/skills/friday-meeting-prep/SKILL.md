# friday-meeting-prep

**觸發詞**：週五開會 / 準備會議 / 建立議程 / Friday meeting / build agenda / weekly meeting prep / 準備會議資料

**用途**：自動查詢本週 PR/issue 數據，產出 4 份文件（議程 + 貢獻紀錄 + 靖杭 JSON + 啟翔 JSON），開 PR 到 staging，等 Young admin merge

**參考 PR**：#1483（merged 2026-05-07）是這個 skill 第一次跑的完整範例

---

## 執行前提

- 在 `chinese-literacy-platform` 主 repo 根目錄
- `gh` CLI 已登入（`gh auth status`）
- `git` worktree 乾淨（`git worktree list` 無衝突）

---

## Step 0：確認日期 + 計算本週 Friday

```bash
TODAY=$(date +%Y-%m-%d)
DOW=$(date +%u)          # 1=Mon … 7=Sun
DAYS_TO_FRI=$((5 - DOW))
[ "$DAYS_TO_FRI" -lt 0 ] && DAYS_TO_FRI=$((DAYS_TO_FRI + 7))
[ "$DAYS_TO_FRI" -eq 0 ] && DAYS_TO_FRI=0   # 今天就是週五

FRIDAY=$(date -v+${DAYS_TO_FRI}d +%Y-%m-%d 2>/dev/null \
  || date -d "+${DAYS_TO_FRI} days" +%Y-%m-%d)

# 本週 Mon（查 PR 用）
MON=$(date -v-$((DOW-1))d +%Y-%m-%d 2>/dev/null \
  || date -d "-$((DOW-1)) days" +%Y-%m-%d)

# 週區間標籤，例如 5/2~5/8
MON_LABEL=$(date -v-$((DOW-1))d +%-m/%-d 2>/dev/null \
  || date -d "-$((DOW-1)) days" +%-m/%-d)
FRI_LABEL=$(date -v+${DAYS_TO_FRI}d +%-m/%-d 2>/dev/null \
  || date -d "+${DAYS_TO_FRI} days" +%-m/%-d)
WEEK_LABEL="${MON_LABEL}~${FRI_LABEL}"

echo "Friday: $FRIDAY | Week: $WEEK_LABEL | Mon (PR search from): $MON"
```

macOS 用 `date -v`，Linux 用 `date -d`。上面已同時相容。

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
BRANCH="feat/issue-${ISSUE_NUM}-friday-meeting-prep-${FRIDAY}"

git worktree add ../chinese-literacy-platform-issue-${ISSUE_NUM} \
  -b "$BRANCH" staging

cd ../chinese-literacy-platform-issue-${ISSUE_NUM}
```

---

## Step 3：產出 4 份文件

### 3a. 議程：docs/meetings/{FRIDAY}-agenda.md

依以下模板填入，**用 Step 1 數據填寫，不要虛構**：

```markdown
# 會議議程 {FRIDAY}（五）

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
## {MON_LABEL} ~ {FRI_LABEL}

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
  "lastReview": "{FRIDAY}",
  ...
}
```

**2. history entries（每個 merged PR 加一條）**

在對應的 skill ID 的 `history` array 末尾 append：
```json
{
  "date": "{FRIDAY}",
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
  docs/meetings/${FRIDAY}-agenda.md \
  docs/meetings/team-contributions.md \
  docs/intern-training/interns/raymond.json \
  docs/intern-training/interns/xiung.json

git commit -m "docs(meeting): ${FRIDAY} agenda + contributions + skill trees (Related to #${ISSUE_NUM})"

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
  --title "docs(meeting): ${FRIDAY} agenda + team contributions + intern skill trees (Fixes #${ISSUE_NUM})" \
  --body "$(cat <<'EOF'
## Summary

- Add \`docs/meetings/{FRIDAY}-agenda.md\` — agenda with 7/1 deadline risk table, action items
- Update \`docs/meetings/team-contributions.md\` — prepend {WEEK_LABEL} week section
- Update \`docs/intern-training/interns/raymond.json\` — lastReview + history entries + skill bumps (if evidence)
- Update \`docs/intern-training/interns/xiung.json\` — lastReview + history entries + skill bumps (if evidence)

## Key agenda items

- {bullet 1 from agenda section 二/三}
- {bullet 2}
- {bullet 3}

## Test plan

- [ ] \`docs/meetings/{FRIDAY}-agenda.md\` renders correctly in GitHub preview
- [ ] \`team-contributions.md\` new week section at top (after header, before last week)
- [ ] \`raymond.json\` valid JSON — \`jq . raymond.json\` passes
- [ ] \`xiung.json\` valid JSON — \`jq . xiung.json\` passes
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
- docs/meetings/${FRIDAY}-agenda.md（新增）
- docs/meetings/team-contributions.md（${WEEK_LABEL} 週區段插入）
- docs/intern-training/interns/raymond.json（lastReview ${FRIDAY}）
- docs/intern-training/interns/xiung.json（lastReview ${FRIDAY}）

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

**Q: 靖杭或啟翔本週沒有 merged PR？**
A: 仍更新 `lastReview`，history 不加新 entry，contributions 表可以省略該人或標 `⏳ 本週無 PR`

**Q: 今天已經是週五了，還要往後找 Friday？**
A: `DAYS_TO_FRI=0`，`$FRIDAY` = 今天

**Q: Step 1c open issues 有很多，怎麼決定放哪些進議程？**
A: 優先順序：
1. `7/1-deadline` label 的 — 全放，加風險標色
2. 無 assignee + open > 2 週 — 放「待討論」section
3. 靖杭/啟翔 open PR > 5 天未更新 — 放「實習生進度」section

**Q: 議程 section 本週無資料要怎麼處理？**
A: 整個 section 省略，不留空表格（避免「本週無議題」類的 filler text）

---

## 範例觸發語句

- 「週五開會」
- 「準備會議資料」
- 「建立議程」
- 「這週五要開會，幫我準備」
- 「Friday meeting prep」
- 「weekly meeting prep」
- 「build agenda for this Friday」
