---
description: When running /catchup or session recovery, also check intern PR activity, update skill trees, and update contributions
globs: ["*"]
---

# Catchup 額外步驟：實習生進度 + 技能樹 + 貢獻紀錄

When running `/catchup` or any session context recovery, add these steps after reading project memory:

## Step 1: Check Intern PR Activity

```bash
echo "=== 實習生待 Review PRs ==="
gh pr list --repo Youngger9765/chinese-literacy-platform --state open --author if-else-master --json number,title,updatedAt --jq '.[] | "靖杭 #\(.number) \(.title) (\(.updatedAt[:10]))"' 2>/dev/null
gh pr list --repo Youngger9765/chinese-literacy-platform --state open --author stgst --json number,title,updatedAt --jq '.[] | "啟翔 #\(.number) \(.title) (\(.updatedAt[:10]))"' 2>/dev/null

echo "=== 最近 7 天 Merged ==="
gh pr list --repo Youngger9765/chinese-literacy-platform --state merged --author if-else-master --limit 5 --json number,title,mergedAt --jq '.[] | select(.mergedAt > (now - 604800 | strftime("%Y-%m-%dT%H:%M:%SZ"))) | "靖杭 #\(.number) \(.title)"' 2>/dev/null
gh pr list --repo Youngger9765/chinese-literacy-platform --state merged --author stgst --limit 5 --json number,title,mergedAt --jq '.[] | select(.mergedAt > (now - 604800 | strftime("%Y-%m-%dT%H:%M:%SZ"))) | "啟翔 #\(.number) \(.title)"' 2>/dev/null
```

Include in briefing under `## 實習生進度`:
- Open PRs → "靖杭有 N 個 PR 待 review"（列出來）
- Recent merges → "啟翔本週 merged N 個 PR"
- 超過 7 天沒有新 PR → "⚠️ [name] 7 天沒有新 PR"

## Step 2: Update Skill Tree JSON

If interns have new merged PRs since `lastReview` in their JSON, spawn `skill-tree-reviewer` agent:

```bash
python3 scripts/skill-tree-updater.py --intern all --days 7
```

This updates:
- `frontend/public/intern-training/interns/raymond.json`（靖杭，SOT — staging dashboard 從此讀）
- `frontend/public/intern-training/interns/xiung.json`（啟翔）

> ⚠️ `docs/intern-training/` 是舊版 mirror，**deprecated**。staging `https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/intern-training/dashboard.html` 從 `frontend/public/intern-training/` 讀。寫錯 path = staging 看不到更新。

If the script fails (e.g. no Vertex AI auth locally), manually review their recent PRs and update the JSON skill levels + history entries.

## Step 3: Update Team Contributions

Update `docs/meetings/team-contributions.md` with the latest week's data:
- Add a new week section at the top (format: `## M/DD ~ M/DD`)
- For each intern, list their merged PRs with status ✅ and open PRs with 🔧
- Include Young's work from the current session

**完成定義**：PR merge 到 staging 即算完成
