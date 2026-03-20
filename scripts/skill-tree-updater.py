#!/usr/bin/env python3
"""
Skill Tree Updater — 自動評估實習生技能進度

透過分析 git commits 並送給 Vertex AI Gemini 評估，
自動更新實習生的技能等級 JSON 檔案。

Usage:
    python3 scripts/skill-tree-updater.py --intern all
    python3 scripts/skill-tree-updater.py --intern raymond --days 14
    python3 scripts/skill-tree-updater.py --intern steven --dry-run
"""

import argparse
import json
import os
import re
import subprocess
import sys
import warnings
from datetime import datetime, timedelta

warnings.filterwarnings("ignore", message=".*deprecated.*", category=UserWarning)
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
INTERNS_DIR = REPO_ROOT / "docs" / "intern-training" / "interns"

INTERN_CONFIG: dict[str, dict[str, str]] = {
    "raymond": {
        "name": "Raymond",
        "github": "if-else-master",
        "git_authors": ["if-else-master", "Raymond"],
        "email": "78069313+if-else-master@users.noreply.github.com",
        "json_file": "raymond.json",
    },
    "steven": {
        "name": "Steven",
        "github": "stgst",
        "git_authors": ["stgst", "xiung", "xiunG"],
        "email": "steven19790906@gmail.com",
        "json_file": "xiung.json",
    },
}

SKILLS: dict[int, dict[str, Any]] = {
    1:  {"name": "Git 基礎",       "tier": 1, "xp": 10, "prereqs": [],       "keywords": ["git", "commit", "push", "pull", "clone"],                          "file_patterns": [".git"]},
    2:  {"name": "HTML/CSS 基礎",   "tier": 1, "xp": 10, "prereqs": [],       "keywords": ["html", "css", "style", "className"],                                "file_patterns": ["*.css", "*.html"]},
    3:  {"name": "JavaScript 基礎", "tier": 1, "xp": 15, "prereqs": [],       "keywords": ["const", "let", "function", "addEventListener", "map", "filter"],    "file_patterns": ["*.js", "*.ts", "*.tsx"]},
    4:  {"name": "開發環境",         "tier": 1, "xp": 10, "prereqs": [],       "keywords": ["npm", "node", "vscode", "package.json"],                            "file_patterns": ["package.json"]},
    5:  {"name": "讀懂現有程式碼",   "tier": 1, "xp": 15, "prereqs": [],       "keywords": ["修改", "fix", "改"],                                                "file_patterns": ["*.tsx", "*.ts"]},
    6:  {"name": "React 元件開發",   "tier": 2, "xp": 25, "prereqs": [3, 5],   "keywords": ["useState", "props", "component", "jsx", "onClick"],                 "file_patterns": ["*.tsx"]},
    7:  {"name": "TypeScript",       "tier": 2, "xp": 20, "prereqs": [3],      "keywords": ["interface", "type", "generic", ": string", ": number"],             "file_patterns": ["*.ts", "*.tsx"]},
    8:  {"name": "Tailwind CSS",     "tier": 2, "xp": 20, "prereqs": [2],      "keywords": ["className", "flex", "p-", "m-", "text-", "bg-"],                    "file_patterns": ["*.tsx"]},
    9:  {"name": "Git 工作流",       "tier": 2, "xp": 20, "prereqs": [1],      "keywords": ["branch", "pr", "merge", "rebase", "review"],                        "file_patterns": []},
    10: {"name": "Bug 修復",         "tier": 2, "xp": 25, "prereqs": [4, 5],   "keywords": ["fix", "bug", "debug", "error"],                                     "file_patterns": ["*.tsx", "*.ts"]},
    11: {"name": "React 進階",       "tier": 3, "xp": 35, "prereqs": [6],      "keywords": ["useEffect", "useRef", "useMemo", "useCallback", "useContext"],      "file_patterns": ["*.tsx"]},
    12: {"name": "API 串接",         "tier": 3, "xp": 30, "prereqs": [6, 7],   "keywords": ["fetch", "api", "async", "await", "response"],                       "file_patterns": ["api.ts", "*.service.ts"]},
    13: {"name": "元件設計模式",     "tier": 3, "xp": 35, "prereqs": [6, 11],  "keywords": ["custom hook", "use", "extract", "refactor", "compound"],            "file_patterns": ["*.tsx"]},
    14: {"name": "測試",             "tier": 3, "xp": 30, "prereqs": [10],     "keywords": ["test", "describe", "it", "expect", "playwright"],                   "file_patterns": ["*.test.*", "*.spec.*"]},
    15: {"name": "Code Review",      "tier": 3, "xp": 25, "prereqs": [9],      "keywords": ["review", "comment", "suggestion"],                                  "file_patterns": []},
    16: {"name": "獨立開發功能",     "tier": 4, "xp": 50, "prereqs": [11, 12, 14], "keywords": ["feat", "feature", "implement"],                                 "file_patterns": ["*.tsx", "*.ts"]},
    17: {"name": "效能優化",         "tier": 4, "xp": 40, "prereqs": [11, 13], "keywords": ["memo", "lazy", "performance", "optimize"],                          "file_patterns": ["*.tsx"]},
    18: {"name": "架構理解",         "tier": 4, "xp": 40, "prereqs": [12, 13], "keywords": ["architecture", "data flow", "route", "service"],                    "file_patterns": ["*.md"]},
    19: {"name": "技術文件",         "tier": 4, "xp": 30, "prereqs": [15],     "keywords": ["doc", "readme", "adr"],                                             "file_patterns": ["*.md"]},
    20: {"name": "指導他人",         "tier": 4, "xp": 50, "prereqs": [15, 16], "keywords": ["pair", "mentor", "teach", "review"],                                "file_patterns": []},
}

LEVELS: dict[int, str] = {
    0: "未接觸",
    1: "初次接觸 — 碰過相關檔案，改動小或有錯",
    2: "理解概念 — 正確修改，但需要指導",
    3: "能獨立使用 — 獨立完成，品質合格",
    4: "熟練運用 — 多次正確使用，有重構意識",
    5: "可以教人 — Review 別人的 code 或寫教材",
}

MAX_DIFF_LINES = 500
GITHUB_REPO = "Youngger9765/chinese-literacy-platform"

# ---------------------------------------------------------------------------
# ANSI colors
# ---------------------------------------------------------------------------

class C:
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"


def stars(level: int, max_level: int = 5) -> str:
    return "\u2605" * level + "\u2606" * (max_level - level)


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def git_log(authors: list[str], email: str, days: int) -> list[dict[str, str]]:
    """Return list of {hash, date, message} for author(s) within N days."""
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    # Collect commits from all author variants + email
    seen_hashes: set[str] = set()
    commits: list[dict[str, str]] = []

    search_terms = list(authors)
    if email:
        search_terms.append(email)

    for author in search_terms:
        cmd = [
            "git", "log", "--all",
            f"--author={author}",
            f"--since={since}",
            "--pretty=format:%H|||%ai|||%s",
        ]
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd=REPO_ROOT, check=True,
            )
        except subprocess.CalledProcessError:
            continue

        for line in result.stdout.strip().splitlines():
            if "|||" not in line:
                continue
            parts = line.split("|||", 2)
            if len(parts) == 3:
                h = parts[0].strip()
                if h not in seen_hashes:
                    seen_hashes.add(h)
                    commits.append({
                        "hash": h,
                        "date": parts[1].strip(),
                        "message": parts[2].strip(),
                    })

    # Sort by date descending
    commits.sort(key=lambda c: c["date"], reverse=True)
    return commits


def git_show(commit_hash: str) -> str:
    """Return the diff of a single commit, truncated to MAX_DIFF_LINES."""
    cmd = ["git", "show", "--stat", "--patch", commit_hash]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, cwd=REPO_ROOT, check=True,
        )
    except subprocess.CalledProcessError:
        return ""
    lines = result.stdout.splitlines()
    if len(lines) > MAX_DIFF_LINES:
        lines = lines[:MAX_DIFF_LINES]
        lines.append(f"\n... (truncated, showing first {MAX_DIFF_LINES} lines)")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# GitHub issue/PR comments
# ---------------------------------------------------------------------------

MAX_COMMENT_CHARS = 500

def gh_issue_comments(github_handle: str, days: int) -> list[dict[str, str]]:
    """Fetch recent issue/PR comments by a GitHub user via `gh` CLI."""
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
    # Search for issue comments by author
    cmd = [
        "gh", "api", "--paginate",
        f"/repos/Youngger9765/chinese-literacy-platform/issues/comments"
        f"?since={since}&sort=created&direction=desc&per_page=100",
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, cwd=REPO_ROOT, timeout=30,
        )
        if result.returncode != 0:
            return []
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return []

    try:
        all_comments = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []

    if not isinstance(all_comments, list):
        return []

    # Filter by author
    comments = []
    for c in all_comments:
        user = c.get("user", {}).get("login", "")
        if user.lower() != github_handle.lower():
            continue
        body = c.get("body", "").strip()
        if not body:
            continue
        # Truncate long comments
        if len(body) > MAX_COMMENT_CHARS:
            body = body[:MAX_COMMENT_CHARS] + "..."
        issue_url = c.get("issue_url", "")
        # Extract issue number from URL
        issue_num = issue_url.rstrip("/").split("/")[-1] if issue_url else "?"
        comments.append({
            "issue": f"#{issue_num}",
            "date": c.get("created_at", "")[:10],
            "body": body,
        })

    return comments[:20]  # Cap at 20 comments


# ---------------------------------------------------------------------------
# GitHub Issues/PRs fetcher
# ---------------------------------------------------------------------------

def git_commit_stat(commit_hash: str) -> str:
    """Return '+N/-M' line-change summary for a single commit."""
    cmd = ["git", "show", "--stat", "--format=", commit_hash]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, cwd=REPO_ROOT, check=True,
        )
    except subprocess.CalledProcessError:
        return ""
    # Last non-empty line of --stat contains "N insertions(+), M deletions(-)"
    for line in reversed(result.stdout.strip().splitlines()):
        m = re.search(r"(\d+) insertion", line)
        d = re.search(r"(\d+) deletion", line)
        ins = m.group(1) if m else "0"
        dels = d.group(1) if d else "0"
        if m or d:
            return f"+{ins}/-{dels}"
    return ""


def extract_issue_numbers(message: str) -> list[str]:
    """Extract issue/PR numbers from commit message (e.g., '#224', 'fix #216')."""
    return [f"#{m}" for m in re.findall(r"#(\d+)", message)]


def gh_issues_and_prs(github_handle: str, days: int) -> list[dict]:
    """Fetch issues assigned to / created by intern, and PRs created by intern."""
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
    items: list[dict] = []
    seen: set[int] = set()

    # Fetch issues (assigned or created by)
    for query_type in ["assignee", "creator"]:
        cmd = [
            "gh", "api", "--paginate",
            f"/repos/{GITHUB_REPO}/issues"
            f"?{query_type}={github_handle}&since={since}"
            f"&state=all&sort=created&direction=desc&per_page=100",
        ]
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd=REPO_ROOT, timeout=30,
            )
            if result.returncode != 0:
                continue
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            continue

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            continue

        if not isinstance(data, list):
            continue

        for item in data:
            num = item.get("number", 0)
            if num in seen:
                continue
            seen.add(num)

            labels = [l.get("name", "") for l in item.get("labels", [])]
            body = item.get("body", "") or ""
            if len(body) > 500:
                body = body[:500] + "..."

            is_pr = "pull_request" in item
            items.append({
                "number": num,
                "id": f"#{num}",
                "title": item.get("title", ""),
                "state": item.get("state", ""),
                "created_at": (item.get("created_at") or "")[:10],
                "closed_at": (item.get("closed_at") or "")[:10] if item.get("closed_at") else None,
                "labels": labels,
                "body": body,
                "is_pr": is_pr,
            })

    # Sort by created_at ascending
    items.sort(key=lambda x: x.get("created_at", ""))
    return items


def compute_lines_changed_by_issue(commits: list[dict]) -> dict[str, str]:
    """Group commits by issue number and sum line changes.

    Returns dict like {"#224": "+32/-8", "#216": "+50/-12"}.
    """
    issue_stats: dict[str, tuple[int, int]] = {}

    for c in commits:
        refs = extract_issue_numbers(c["message"])
        if not refs:
            continue
        stat = git_commit_stat(c["hash"])
        if not stat:
            continue
        m = re.match(r"\+(\d+)/-(\d+)", stat)
        if not m:
            continue
        ins, dels = int(m.group(1)), int(m.group(2))
        for ref in refs:
            prev = issue_stats.get(ref, (0, 0))
            issue_stats[ref] = (prev[0] + ins, prev[1] + dels)

    return {k: f"+{v[0]}/-{v[1]}" for k, v in issue_stats.items()}


# ---------------------------------------------------------------------------
# JSON file I/O — migrate old format to new progressive format
# ---------------------------------------------------------------------------

def load_intern_json(path: Path) -> dict:
    """Load intern JSON, migrating old flat format to progressive format."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Already in new format
    if "skills" in data and isinstance(data.get("skills"), dict):
        first_val = next(iter(data["skills"].values()), None)
        if isinstance(first_val, dict) and "level" in first_val:
            return data

    # Migrate from old format (completed + reviewNotes)
    today = datetime.now().strftime("%Y-%m-%d")
    skills: dict[str, dict] = {}
    completed = data.get("completed", [])
    review_notes = data.get("reviewNotes", {})

    for skill_id in completed:
        sid = str(skill_id)
        note = review_notes.get(sid, "已完成")
        # Old format had no levels; assume level 2 ("理解概念") as baseline
        # since they were marked completed with review notes
        skills[sid] = {
            "level": 2,
            "maxLevel": 5,
            "history": [
                {
                    "date": data.get("lastReview", today),
                    "level": 2,
                    "reason": note,
                }
            ],
        }

    migrated = {
        "name": data.get("name", ""),
        "github": data.get("github", ""),
        "email": data.get("email", ""),
        "startDate": data.get("startDate", today),
        "lastReview": data.get("lastReview", today),
        "skills": skills,
        "recommendations": data.get("recommendations", []),
    }
    return migrated


def save_intern_json(path: Path, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ---------------------------------------------------------------------------
# Vertex AI Gemini
# ---------------------------------------------------------------------------

def call_gemini(prompt: str) -> dict | None:
    """Send prompt to Gemini and parse JSON response. Retry once on parse failure."""
    try:
        import vertexai
        from vertexai.generative_models import GenerativeModel, GenerationConfig
    except ImportError:
        print(f"{C.RED}vertexai SDK not installed. Run: pip install google-cloud-aiplatform{C.RESET}")
        sys.exit(1)

    try:
        vertexai.init(project="lingoleap-dev", location="us-central1")
    except Exception as exc:
        print(f"{C.RED}Vertex AI init failed: {exc}{C.RESET}")
        sys.exit(1)

    model = GenerativeModel("gemini-2.0-flash")

    response_schema = {
        "type": "object",
        "properties": {
            "skill_updates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "skill_id": {"type": "integer"},
                        "new_level": {"type": "integer"},
                        "reason": {"type": "string"},
                    },
                    "required": ["skill_id", "new_level", "reason"],
                },
            },
            "recommendations": {
                "type": "array",
                "items": {"type": "string"},
            },
            "summary": {"type": "string"},
            "issue_contributions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
                        "date": {"type": "string"},
                        "type": {"type": "string"},
                        "contribution": {"type": "string"},
                        "skillsLearned": {
                            "type": "array",
                            "items": {"type": "integer"},
                        },
                        "highlights": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "linesChanged": {"type": "string"},
                    },
                    "required": ["id", "title", "date", "type",
                                 "contribution", "skillsLearned", "highlights"],
                },
            },
        },
        "required": ["skill_updates", "recommendations", "summary",
                     "issue_contributions"],
    }

    gen_config = GenerationConfig(
        max_output_tokens=8192,
        temperature=0.2,
        response_mime_type="application/json",
        response_schema=response_schema,
    )

    for attempt in range(2):
        try:
            response = model.generate_content(
                prompt,
                generation_config=gen_config,
            )
            text = response.text.strip()
            # Strip markdown code fences if present
            text = re.sub(r"^```(?:json)?\s*\n?", "", text)
            text = re.sub(r"\n?\s*```\s*$", "", text)
            # Try to extract JSON object if surrounded by other text
            json_match = re.search(r"\{[\s\S]*\}", text)
            if json_match:
                text = json_match.group(0)
            return json.loads(text)
        except json.JSONDecodeError as e:
            if attempt == 0:
                print(f"   {C.YELLOW}Gemini JSON 格式錯誤: {e}，重試中...{C.RESET}")
                continue
            print(f"   {C.RED}Gemini 回傳非 JSON 格式，跳過此評估{C.RESET}")
            return None
        except Exception as exc:
            print(f"   {C.RED}Gemini API 呼叫失敗: {exc}{C.RESET}")
            return None

    return None


def build_prompt(
    intern_name: str,
    intern_github: str,
    current_skills: dict,
    commits_text: str,
    comments_text: str,
    issues_text: str,
    lines_changed_by_issue: dict[str, str],
    days: int,
) -> str:
    skills_defs = json.dumps(
        {str(k): {"name": v["name"], "tier": v["tier"], "keywords": v["keywords"]}
         for k, v in SKILLS.items()},
        ensure_ascii=False,
        indent=2,
    )

    current_json = json.dumps(
        {sid: {"name": SKILLS[int(sid)]["name"], "level": s["level"]}
         for sid, s in current_skills.items()},
        ensure_ascii=False,
        indent=2,
    ) if current_skills else "{}"

    lines_changed_json = json.dumps(lines_changed_by_issue, ensure_ascii=False)

    return f"""你是一個軟體實習生的技能評估助理。這些實習生是高中生，正在開發 LingoLeap 中文閱讀學習平台（React + TypeScript + Tailwind 前端）。

## 實習生資訊
名稱：{intern_name}
GitHub：@{intern_github}
目前技能等級：{current_json}

## 最近的 Git Commits（過去 {days} 天）
{commits_text}

## GitHub Issue/PR 留言（過去 {days} 天）
{comments_text if comments_text else "（無留言）"}

## GitHub Issues/PRs（過去 {days} 天）
{issues_text if issues_text else "（無 Issues/PRs）"}

## 各 Issue 的程式碼修改量
{lines_changed_json}

## 20 個技能定義
{skills_defs}

## 等級定義
1 = 初次接觸（碰過相關檔案，改動小或有錯）
2 = 理解概念（正確修改，但需要指導）
3 = 能獨立使用（獨立完成，品質合格）
4 = 熟練運用（多次正確使用，有重構意識）
5 = 可以教人（Review 別人的 code 或寫教材）

## 請你做以下事情：

### Part 1: 技能評估
1. 分析 commits 和 issue 留言展現了哪些技能（留言可反映：問題分析能力、溝通能力、code review 能力、架構理解等）
2. 評估每個有變化的技能應該是什麼等級（1-5）
3. 等級只能維持或上升，不能下降
4. 如果證據不足，不要猜測，保持原等級
5. 給出 2-3 個具體的下一步建議（包含推薦的 GitHub Issue 編號）

### Part 2: Issue 貢獻分析
分析這位實習生參與的每個 Issue/PR，產出 issue_contributions 陣列。對每個 Issue/PR：
1. 從 commit messages 和 issue labels 推斷 type：
   - commit 含 "fix:" 或 issue 有 "bug" label → "bugfix"
   - commit 含 "feat:" 或 issue 有 "feature" label → "feature"
   - commit 含 "refactor:" → "refactor"
   - 環境設定相關 → "setup"
   - 預設 → "feature"
2. 用中文寫一句話描述這個 Issue 對平台的貢獻（contribution 欄位）
3. 列出學到的技能 ID（skillsLearned，從 1-20 的技能定義中選）
4. 列出 1-3 個做得好的地方（highlights，中文）
5. 如果有對應的程式碼修改量資料，填入 linesChanged（格式："+N/-M"）
6. date 填寫該 issue 最近一次有活動的日期

回覆格式（嚴格 JSON）：
{{
  "skill_updates": [
    {{"skill_id": 1, "new_level": 3, "reason": "簡短原因（20字以內）"}}
  ],
  "recommendations": ["建議1", "建議2"],
  "summary": "一句話總結（30字以內）",
  "issue_contributions": [
    {{
      "id": "#224",
      "title": "Issue 標題",
      "date": "2026-03-05",
      "type": "feature",
      "contribution": "一句話描述對平台的貢獻（中文）",
      "skillsLearned": [2, 3, 5],
      "highlights": ["做得好的地方1", "做得好的地方2"],
      "linesChanged": "+32/-8"
    }}
  ]
}}

重要：reason 和 summary 必須簡短精煉，每個 reason 不超過 20 個中文字。只輸出 JSON。"""


# ---------------------------------------------------------------------------
# Core evaluation logic
# ---------------------------------------------------------------------------

def evaluate_intern(
    intern_key: str,
    days: int,
    dry_run: bool,
) -> bool:
    """Evaluate a single intern. Returns True if successful."""
    config = INTERN_CONFIG[intern_key]
    json_path = INTERNS_DIR / config["json_file"]

    print(f"\n{'='*60}")
    print(f"  評估 {config['name']} (@{config['github']}) 最近 {days} 天...")
    print(f"{'='*60}")

    # Load current data
    if not json_path.exists():
        print(f"   {C.RED}JSON 檔案不存在: {json_path}{C.RESET}")
        return False

    intern_data = load_intern_json(json_path)

    # Populate config fields into data if missing
    if not intern_data.get("email") and config.get("email"):
        intern_data["email"] = config["email"]

    # Get commits
    git_authors = config.get("git_authors", [config["github"]])
    commits = git_log(git_authors, config.get("email", ""), days)

    # Get issue/PR comments
    comments = gh_issue_comments(config["github"], days)

    if not commits and not comments:
        print(f"   {C.YELLOW}找不到任何 commits 或留言，跳過{C.RESET}")
        return False

    if commits:
        print(f"   找到 {C.CYAN}{len(commits)}{C.RESET} 個 commits")
    if comments:
        print(f"   找到 {C.CYAN}{len(comments)}{C.RESET} 則 issue 留言")
    print()

    # Build commits text with diffs
    commits_parts = []
    for i, c in enumerate(commits, 1):
        diff = git_show(c["hash"])
        commits_parts.append(
            f"### Commit {i}: {c['message']}\n"
            f"Date: {c['date']}\n"
            f"Hash: {c['hash'][:8]}\n"
            f"```diff\n{diff}\n```\n"
        )
    commits_text = "\n".join(commits_parts) if commits_parts else "（無 commits）"

    # Build comments text
    comments_parts = []
    for i, c in enumerate(comments, 1):
        comments_parts.append(
            f"### 留言 {i} ({c['issue']}, {c['date']})\n{c['body']}\n"
        )
    comments_text = "\n".join(comments_parts)

    # Fetch issues/PRs
    issues = gh_issues_and_prs(config["github"], days)
    if issues:
        print(f"   找到 {C.CYAN}{len(issues)}{C.RESET} 個 Issues/PRs")

    # Build issues text
    issues_parts = []
    for i, iss in enumerate(issues, 1):
        labels_str = ", ".join(iss["labels"]) if iss["labels"] else "（無 label）"
        pr_tag = " [PR]" if iss["is_pr"] else ""
        issues_parts.append(
            f"### {iss['id']}{pr_tag}: {iss['title']}\n"
            f"State: {iss['state']} | Created: {iss['created_at']}"
            f"{' | Closed: ' + iss['closed_at'] if iss['closed_at'] else ''}\n"
            f"Labels: {labels_str}\n"
            f"Body: {iss['body'][:300] if iss['body'] else '（無內容）'}\n"
        )
    issues_text = "\n".join(issues_parts)

    # Compute line changes grouped by issue number
    lines_changed_by_issue = compute_lines_changed_by_issue(commits)

    # Build prompt
    prompt = build_prompt(
        intern_name=config["name"],
        intern_github=config["github"],
        current_skills=intern_data.get("skills", {}),
        commits_text=commits_text,
        comments_text=comments_text,
        issues_text=issues_text,
        lines_changed_by_issue=lines_changed_by_issue,
        days=days,
    )

    if dry_run:
        print(f"   {C.YELLOW}[DRY RUN] Prompt: {len(prompt)} chars "
              f"({len(commits)} commits + {len(comments)} comments + {len(issues)} issues){C.RESET}")
        if lines_changed_by_issue:
            print(f"   {C.YELLOW}[DRY RUN] Line changes by issue: {lines_changed_by_issue}{C.RESET}")
        print(f"   {C.YELLOW}[DRY RUN] 跳過 Gemini 呼叫與 JSON 更新{C.RESET}")
        return True

    # Call Gemini
    print(f"   正在呼叫 Gemini 評估...")
    result = call_gemini(prompt)
    if result is None:
        return False

    # Apply updates
    today = datetime.now().strftime("%Y-%m-%d")
    current_skills = intern_data.get("skills", {})
    updates = result.get("skill_updates", [])
    changes: list[dict] = []

    print(f"\n   {C.BOLD}Gemini 評估結果：{C.RESET}")

    for update in updates:
        sid = str(update.get("skill_id", ""))
        new_level = update.get("new_level", 0)
        reason = update.get("reason", "")

        if sid not in {str(k) for k in SKILLS}:
            continue

        skill_name = SKILLS[int(sid)]["name"]
        old_level = current_skills.get(sid, {}).get("level", 0)

        # Level can only stay or go up
        if new_level < old_level:
            new_level = old_level

        if new_level > old_level:
            # Level up
            if sid not in current_skills:
                current_skills[sid] = {
                    "level": 0,
                    "maxLevel": 5,
                    "history": [],
                }
            current_skills[sid]["level"] = new_level
            current_skills[sid]["maxLevel"] = 5
            current_skills[sid]["history"].append({
                "date": today,
                "level": new_level,
                "reason": reason,
            })
            changes.append({
                "sid": sid, "name": skill_name,
                "old": old_level, "new": new_level, "reason": reason,
            })
            print(
                f"   {C.GREEN}   #{sid} {skill_name}: "
                f"{stars(old_level)} -> {stars(new_level)} "
                f"({reason}){C.RESET}"
            )
        else:
            print(
                f"   {C.DIM}   -- #{sid} {skill_name}: "
                f"{stars(old_level)} (不變){C.RESET}"
            )

    # Update intern data
    intern_data["skills"] = current_skills
    intern_data["lastReview"] = today
    intern_data["recommendations"] = result.get("recommendations", [])

    # Merge issue_contributions into existing issues (keep old, add/update new by id)
    new_contributions = result.get("issue_contributions", [])
    if new_contributions:
        existing_issues: list[dict] = intern_data.get("issues", [])
        existing_by_id = {iss["id"]: iss for iss in existing_issues}

        for contrib in new_contributions:
            cid = contrib.get("id", "")
            if not cid:
                continue
            # Inject linesChanged from computed data if Gemini didn't provide it
            if not contrib.get("linesChanged") and cid in lines_changed_by_issue:
                contrib["linesChanged"] = lines_changed_by_issue[cid]
            existing_by_id[cid] = contrib

        # Sort by date ascending
        merged = sorted(existing_by_id.values(), key=lambda x: x.get("date", ""))
        intern_data["issues"] = merged

        print(f"\n   {C.BOLD}Issue 貢獻：{C.RESET}")
        for ic in new_contributions:
            type_emoji = {"feature": "feat", "bugfix": "fix",
                          "refactor": "refactor", "setup": "setup"}.get(
                ic.get("type", ""), ic.get("type", ""))
            lines = ic.get("linesChanged", "")
            lines_str = f" ({lines})" if lines else ""
            print(f"   {C.GREEN}   [{type_emoji}] {ic.get('id', '?')}: "
                  f"{ic.get('contribution', '')}{lines_str}{C.RESET}")

    # Save
    save_intern_json(json_path, intern_data)
    print(f"\n   JSON 已更新: {C.CYAN}{json_path.relative_to(REPO_ROOT)}{C.RESET}")

    # Summary
    summary = result.get("summary", "")
    if summary:
        print(f"\n   {C.BOLD}總結：{C.RESET}{summary}")

    # Recommendations
    recs = result.get("recommendations", [])
    if recs:
        print(f"\n   {C.BOLD}建議：{C.RESET}")
        for i, rec in enumerate(recs, 1):
            print(f"   {i}. {rec}")

    return True


# ---------------------------------------------------------------------------
# Summary table
# ---------------------------------------------------------------------------

def print_summary(intern_keys: list[str]) -> None:
    """Print a combined summary table for all evaluated interns."""
    print(f"\n{'='*60}")
    print(f"  {C.BOLD}技能總覽{C.RESET}")
    print(f"{'='*60}")

    for key in intern_keys:
        config = INTERN_CONFIG[key]
        json_path = INTERNS_DIR / config["json_file"]
        if not json_path.exists():
            continue

        data = load_intern_json(json_path)
        skills = data.get("skills", {})

        print(f"\n  {C.BOLD}{config['name']} (@{config['github']}){C.RESET}")
        print(f"  {'─'*50}")

        # Sort by tier then skill id
        sorted_ids = sorted(
            skills.keys(),
            key=lambda s: (SKILLS.get(int(s), {}).get("tier", 99), int(s)),
        )
        for sid in sorted_ids:
            s = skills[sid]
            skill_def = SKILLS.get(int(sid))
            if not skill_def:
                continue
            tier = skill_def["tier"]
            name = skill_def["name"]
            level = s.get("level", 0)
            print(f"  T{tier} | #{sid:>2} {name:<16} {stars(level)}")

        # Show untouched skills
        untouched = [
            k for k in sorted(SKILLS.keys())
            if str(k) not in skills
        ]
        if untouched:
            names = ", ".join(f"#{k}" for k in untouched[:5])
            remaining = len(untouched) - 5
            suffix = f" +{remaining} more" if remaining > 0 else ""
            print(f"  {C.DIM}  未接觸: {names}{suffix}{C.RESET}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="評估實習生技能進度 (Vertex AI Gemini)",
    )
    parser.add_argument(
        "--intern",
        required=True,
        choices=["raymond", "steven", "all"],
        help="要評估的實習生 (raymond|steven|all)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        help="分析最近幾天的 commits (default: 7)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只顯示會做什麼，不呼叫 Gemini 也不更新 JSON",
    )
    args = parser.parse_args()

    if args.intern == "all":
        targets = list(INTERN_CONFIG.keys())
    else:
        targets = [args.intern]

    print(f"{C.BOLD}Skill Tree Updater{C.RESET}")
    print(f"日期: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"範圍: 最近 {args.days} 天")
    if args.dry_run:
        print(f"{C.YELLOW}[DRY RUN 模式]{C.RESET}")

    success_count = 0
    for key in targets:
        ok = evaluate_intern(key, args.days, args.dry_run)
        if ok:
            success_count += 1

    if not args.dry_run:
        print_summary(targets)

    print(f"\n完成！評估了 {success_count}/{len(targets)} 位實習生。")


if __name__ == "__main__":
    main()
