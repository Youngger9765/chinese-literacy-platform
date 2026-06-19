#!/usr/bin/env python3
"""Full staging UI scan: /learn/{id}/story-structure for every published story."""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BROWSE = Path.home() / ".claude/skills/gstack/browse/dist/browse"
STAGING_FE = "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app"
STAGING_BE = "https://lingoleap-backend-staging-958347263320.asia-east1.run.app"
REPORT = ROOT / "private/curriculum-source/_online-schema/ui_full_scan.json"
FAIL_SHOTS = ROOT / ".qa-screenshots/ui-fail"


def browse(*args: str, timeout: int = 120) -> str:
    cmd = [str(BROWSE), *args]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0 and "Navigated to" not in out and "Clicked" not in out:
        raise RuntimeError(f"browse failed: {' '.join(args)}\n{out}")
    return out


def js(expr: str) -> str:
    out = browse("js", expr, timeout=60)
    for line in out.splitlines():
        line = line.strip()
        if line and not line.startswith("[browse]"):
            return line
    return ""


def login_student() -> None:
    browse("goto", f"{STAGING_FE}/login")
    time.sleep(1)
    browse("snapshot", "-i")
    browse("click", "@e8")
    for _ in range(20):
        time.sleep(1)
        href = js("location.href")
        if "/student" in href or "/learn" in href:
            return
        if href.endswith("/login") is False:
            return
    raise RuntimeError("login timeout")


def fetch_story_ids(token: str) -> list[dict]:
    stories: list[dict] = []
    page = 1
    while True:
        url = f"{STAGING_BE}/api/stories?page={page}&page_size=300"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
        stories.extend(data["stories"])
        if len(stories) >= data["total"]:
            break
        page += 1
    return stories


def check_page(story_id: int) -> dict:
    browse("goto", f"{STAGING_FE}/learn/{story_id}/story-structure", timeout=90)
    time.sleep(2.5)
    raw = js(
        """(() => {
  const href = location.href;
  const text = document.body.innerText || '';
  const table = document.querySelector('[data-story-structure-table]');
  const err = text.includes('無法載入文章重點表') || text.includes('請重新整理');
  const loading = text.includes('正在整理文章重點');
  const login = href.includes('/login');
  const title = text.match(/《[^》]+》/)?.[0] || '';
  const rowCount = table ? table.querySelectorAll('tr').length : 0;
  return JSON.stringify({href, err, loading, login, hasTable: !!table, rowCount, title});
})()"""
    )
    try:
        state = json.loads(raw)
    except json.JSONDecodeError:
        state = {"href": raw, "err": True, "parse_error": True}
    ok = (
        not state.get("login")
        and not state.get("err")
        and not state.get("loading")
        and state.get("hasTable")
        and state.get("rowCount", 0) > 0
    )
    state["ok"] = ok
    return state


def main() -> int:
    if not BROWSE.exists():
        print(f"browse not found: {BROWSE}", file=sys.stderr)
        return 2

    login_body = json.dumps({"email": "student@test.com", "password": "student1234"}).encode()
    req = urllib.request.Request(
        f"{STAGING_BE}/api/auth/login",
        data=login_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        token = json.loads(resp.read().decode())["access_token"]

    stories = fetch_story_ids(token)
    FAIL_SHOTS.mkdir(parents=True, exist_ok=True)

    print(f"Logging in as 小明...")
    login_student()

    results: list[dict] = []
    fails: list[dict] = []
    t0 = time.time()

    for i, s in enumerate(stories, 1):
        sid = s["id"]
        code = s.get("grade_code") or ""
        title = s.get("title", "")[:30]
        try:
            state = check_page(sid)
        except Exception as exc:
            state = {"ok": False, "error": str(exc)}
        item = {
            "id": sid,
            "grade_code": code,
            "title": title,
            **state,
        }
        results.append(item)
        if not item.get("ok"):
            fails.append(item)
            try:
                browse(
                    "screenshot",
                    "-o",
                    str(FAIL_SHOTS / f"story-{sid}-{code or 'unknown'}.png"),
                    timeout=30,
                )
            except Exception:
                pass
        status = "OK" if item.get("ok") else "FAIL"
        print(f"[{i:3}/{len(stories)}] {status} id={sid} {code} {title}", flush=True)

    elapsed = round(time.time() - t0, 1)
    report = {
        "total": len(stories),
        "pass": sum(1 for r in results if r.get("ok")),
        "fail": len(fails),
        "elapsed_sec": elapsed,
        "failures": fails,
        "results": results,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 60)
    print(f"UI SCAN DONE: {report['pass']}/{report['total']} pass, {report['fail']} fail ({elapsed}s)")
    print(f"Report: {REPORT}")
    if fails:
        print("Failures:")
        for f in fails:
            print(f"  id={f['id']} {f.get('grade_code')} {f.get('title')} -> {f}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
