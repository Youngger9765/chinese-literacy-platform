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
from datetime import datetime, timedelta
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
        "email": "",
        "json_file": "raymond.json",
    },
    "steven": {
        "name": "Steven",
        "github": "stgst",
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

def git_log(author: str, days: int) -> list[dict[str, str]]:
    """Return list of {hash, date, message} for an author within N days."""
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
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
    except subprocess.CalledProcessError as exc:
        print(f"{C.RED}git log failed for {author}: {exc}{C.RESET}")
        return []

    commits = []
    for line in result.stdout.strip().splitlines():
        if "|||" not in line:
            continue
        parts = line.split("|||", 2)
        if len(parts) == 3:
            commits.append({
                "hash": parts[0].strip(),
                "date": parts[1].strip(),
                "message": parts[2].strip(),
            })
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

    model = GenerativeModel("gemini-2.5-flash")
    gen_config = GenerationConfig(
        max_output_tokens=1024,
        temperature=0.2,
    )

    for attempt in range(2):
        try:
            response = model.generate_content(
                prompt,
                generation_config=gen_config,
            )
            text = response.text.strip()
            # Strip markdown code fences if present
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
            return json.loads(text)
        except json.JSONDecodeError:
            if attempt == 0:
                print(f"   {C.YELLOW}Gemini JSON 格式錯誤，重試中...{C.RESET}")
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

    return f"""你是一個軟體實習生的技能評估助理。這些實習生是高中生，正在開發 LingoLeap 中文閱讀學習平台（React + TypeScript + Tailwind 前端）。

## 實習生資訊
名稱：{intern_name}
GitHub：@{intern_github}
目前技能等級：{current_json}

## 最近的 Git Commits（過去 {days} 天）
{commits_text}

## 20 個技能定義
{skills_defs}

## 等級定義
1 = 初次接觸（碰過相關檔案，改動小或有錯）
2 = 理解概念（正確修改，但需要指導）
3 = 能獨立使用（獨立完成，品質合格）
4 = 熟練運用（多次正確使用，有重構意識）
5 = 可以教人（Review 別人的 code 或寫教材）

## 請你做以下事情：

1. 分析這些 commits 展現了哪些技能
2. 評估每個有變化的技能應該是什麼等級（1-5）
3. 等級只能維持或上升，不能下降
4. 如果證據不足，不要猜測，保持原等級
5. 給出 2-3 個具體的下一步建議（包含推薦的 GitHub Issue 編號）

回覆格式（嚴格 JSON）：
{{
  "skill_updates": [
    {{"skill_id": 1, "new_level": 3, "reason": "具體原因"}}
  ],
  "recommendations": ["建議1", "建議2"],
  "summary": "一句話總結這段時間的成長"
}}

只輸出 JSON，不要其他文字。"""


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
    print(f"  評估 {config['name']} (@{config['github']}) 最近 {days} 天的 commits...")
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
    commits = git_log(config["github"], days)
    if not commits:
        print(f"   {C.YELLOW}找不到任何 commits，跳過{C.RESET}")
        return False

    print(f"   找到 {C.CYAN}{len(commits)}{C.RESET} 個 commits\n")

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
    commits_text = "\n".join(commits_parts)

    # Build prompt
    prompt = build_prompt(
        intern_name=config["name"],
        intern_github=config["github"],
        current_skills=intern_data.get("skills", {}),
        commits_text=commits_text,
        days=days,
    )

    if dry_run:
        print(f"   {C.YELLOW}[DRY RUN] 會送出的 prompt 長度: {len(prompt)} chars{C.RESET}")
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
