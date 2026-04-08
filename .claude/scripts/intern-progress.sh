#!/bin/bash
# SessionStart hook: check intern PR activity
echo "=== 實習生進度 ==="

echo "--- 待 Review PRs ---"
open_raymond=$(gh pr list --repo Youngger9765/chinese-literacy-platform --state open --author if-else-master --json number,title --jq '.[] | "靖杭 #\(.number) \(.title)"' 2>/dev/null)
open_steven=$(gh pr list --repo Youngger9765/chinese-literacy-platform --state open --author stgst --json number,title --jq '.[] | "啟翔 #\(.number) \(.title)"' 2>/dev/null)

if [ -n "$open_raymond" ]; then echo "$open_raymond"; fi
if [ -n "$open_steven" ]; then echo "$open_steven"; fi
if [ -z "$open_raymond" ] && [ -z "$open_steven" ]; then echo "(無待 review PRs)"; fi

echo "--- 最近 7 天 Merged ---"
merged_raymond=$(gh pr list --repo Youngger9765/chinese-literacy-platform --state merged --author if-else-master --limit 5 --json number,title,mergedAt --jq '.[] | select(.mergedAt > (now - 604800 | strftime("%Y-%m-%dT%H:%M:%SZ"))) | "靖杭 #\(.number) \(.title)"' 2>/dev/null)
merged_steven=$(gh pr list --repo Youngger9765/chinese-literacy-platform --state merged --author stgst --limit 5 --json number,title,mergedAt --jq '.[] | select(.mergedAt > (now - 604800 | strftime("%Y-%m-%dT%H:%M:%SZ"))) | "啟翔 #\(.number) \(.title)"' 2>/dev/null)

if [ -n "$merged_raymond" ]; then echo "$merged_raymond"; fi
if [ -n "$merged_steven" ]; then echo "$merged_steven"; fi
if [ -z "$merged_raymond" ] && [ -z "$merged_steven" ]; then echo "⚠️ 兩人 7 天內都沒有 merged PR"; fi

echo "==================="
