#!/usr/bin/env python3
"""Story structure QA — unified L1–L5 gates per docs/qa/story-structure-verification-standard.md.

Usage:
    backend/.venv/bin/python scripts/story_structure_qa.py --all
    backend/.venv/bin/python scripts/story_structure_qa.py --gates L1,L2,L3
    backend/.venv/bin/python scripts/story_structure_qa.py --smoke
    backend/.venv/bin/python scripts/story_structure_qa.py --gates L5 --no-ui   # API only
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.services.lesson_code_normalization import (  # noqa: E402
    catalog_to_parsed_code,
    normalize_manifest_code,
    parsed_to_catalog_codes,
)

from story_structure_qa_lib import (  # noqa: E402
    IMAGE_TEXT_LESSONS,
    LessonTier,
    SMOKE_LESSONS,
    classify_lesson,
    count_checkbox_cells_in_table,
    gate_l1_pass,
    gate_l3_mode_expectation,
    http_retry_wait_s,
    l5_issues_retriable,
    summarize_gate,
    STRUCTURE_HTTP_BACKOFF_S,
    STRUCTURE_HTTP_RETRY_CODES,
    ui_pass_from_dom,
    verify_interaction_profile_contract,
)

DEFAULT_SCHEMA_DIR = ROOT / "private/curriculum-source/_online-schema"
DEFAULT_STAGING = "https://lingoleap-backend-staging-958347263320.asia-east1.run.app"
DEFAULT_STAGING_FE = "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app"
REPORT_PATH = DEFAULT_SCHEMA_DIR / "story_structure_qa_report.json"
BROWSE = Path.home() / ".claude/skills/gstack/browse/dist/browse"
L5_RELOGIN_EVERY = 15
DEFAULT_STRUCTURE_PACING_S = 0.25


def load_mod(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def http_json(url: str, *, token: str | None = None, method: str = "GET", body: dict | None = None) -> dict:
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def http_json_retry(
    url: str,
    *,
    token: str | None = None,
    method: str = "GET",
    body: dict | None = None,
    retry_on: frozenset[int] = STRUCTURE_HTTP_RETRY_CODES,
) -> dict:
    """HTTP JSON with exponential backoff on rate-limit / transient errors."""
    last_err: urllib.error.HTTPError | None = None
    max_attempts = len(STRUCTURE_HTTP_BACKOFF_S) + 1
    for attempt in range(max_attempts):
        try:
            return http_json(url, token=token, method=method, body=body)
        except urllib.error.HTTPError as exc:
            last_err = exc
            if exc.code not in retry_on or attempt >= max_attempts - 1:
                raise
            retry_after = None
            if exc.headers:
                retry_after = exc.headers.get("Retry-After")
            wait = http_retry_wait_s(attempt, retry_after=retry_after)
            if wait is None:
                raise
            print(
                f"HTTP {exc.code} retry {attempt + 1}/{max_attempts - 1} in {wait:.0f}s: {url}",
                flush=True,
            )
            time.sleep(wait)
    if last_err is not None:
        raise last_err
    raise RuntimeError(f"http_json_retry failed: {url}")


def fetch_staging_structure(staging_be: str, story_id: int, token: str) -> dict:
    return http_json_retry(f"{staging_be}/api/stories/{story_id}/structure", token=token)


def login_staging(base: str) -> str:
    email = os.environ.get("QA_STUDENT_EMAIL")
    password = os.environ.get("QA_STUDENT_PASSWORD")
    if not email or not password:
        raise RuntimeError(
            "Set QA_STUDENT_EMAIL and QA_STUDENT_PASSWORD before running staging QA"
        )
    return http_json(
        f"{base}/api/auth/login",
        method="POST",
        body={"email": email, "password": password},
    )["access_token"]


def table_fingerprint(table: list) -> str:
    return json.dumps(table, ensure_ascii=False, sort_keys=True)


def browse_cmd(*args: str, timeout: int = 120) -> str:
    r = subprocess.run([str(BROWSE), *args], capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0 and "Navigated to" not in out and "Clicked" not in out:
        raise RuntimeError(f"browse failed: {args}\n{out}")
    return out


def browse_js(expr: str) -> str:
    out = browse_cmd("js", expr, timeout=60)
    for line in out.splitlines():
        line = line.strip()
        if line and not line.startswith("[browse]"):
            return line
    return ""


def ensure_browser_logout(fe_base: str) -> None:
    """Click 登出 if a session is active (ignore if already logged out)."""
    browse_cmd("goto", f"{fe_base}/student", timeout=60)
    time.sleep(1.0)
    clicked = browse_js(
        """(() => {
  const btn = Array.from(document.querySelectorAll('button'))
    .find(b => (b.textContent || '').includes('登出'));
  if (btn) { btn.click(); return 'logout'; }
  return 'no-logout';
})()"""
    )
    if clicked != "logout":
        return
    for _ in range(20):
        time.sleep(0.5)
        if "/login" in browse_js("location.href"):
            return
    time.sleep(1.0)


def ensure_browser_login(fe_base: str, *, fresh: bool = False) -> None:
    if fresh:
        ensure_browser_logout(fe_base)
    for _attempt in range(3):
        browse_cmd("goto", f"{fe_base}/login")
        time.sleep(2)
        clicked = browse_js(
            """(() => {
  const btn = Array.from(document.querySelectorAll('button'))
    .find(b => {
      const t = b.textContent || '';
      return t.includes('學生') && t.includes('小明');
    });
  if (btn) { btn.click(); return 'clicked'; }
  return 'missing';
})()"""
        )
        if clicked != "clicked":
            time.sleep(1)
            continue
        for _ in range(40):
            time.sleep(1)
            href = browse_js("location.href")
            if "/login" not in href:
                time.sleep(1.5)
                return
    raise RuntimeError("browser login timeout")


def assert_browser_logged_in(fe_base: str) -> None:
    href = browse_js("location.href")
    if "/login" in href:
        raise RuntimeError(f"browser session not logged in: {href}")
    browse_cmd("goto", f"{fe_base}/student", timeout=60)
    time.sleep(0.5)
    href = browse_js("location.href")
    if "/login" in href:
        raise RuntimeError(f"browser session lost after student goto: {href}")


def _read_ui_dom_state() -> dict:
    raw = browse_js(
        """(() => {
  const text = document.body.innerText || '';
  const table = document.querySelector('[data-story-structure-table]');
  const interactive = document.querySelector('[data-story-structure-interactive]');
  const lessonText = document.querySelector('[data-comprehension-lesson-text]');
  const checkboxes = table ? table.querySelectorAll('input[type=checkbox]').length : 0;
  return JSON.stringify({
    href: location.href,
    err: text.includes('無法載入文章重點表') || text.includes('請重新整理'),
    loading: text.includes('正在整理文章重點'),
    login: location.href.includes('/login'),
    hasTable: !!table,
    hasInteractive: !!interactive,
    hasCheckbox: checkboxes > 0,
    hasLessonText: !!lessonText,
    rowCount: table ? table.querySelectorAll('tr').length : 0,
  });
})()"""
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"parse_error": True, "raw": raw}


def check_ui_page(
    story_id: int,
    fe_base: str,
    require_lesson_text: bool,
    *,
    relogin: Callable[[], None] | None = None,
    max_wait_s: float = 18.0,
) -> dict:
    state: dict = {}
    for attempt in range(3):
        browse_cmd("goto", f"{fe_base}/learn/{story_id}/story-structure", timeout=90)
        time.sleep(1.0)
        browse_js(
            """(() => {
  const btn = Array.from(document.querySelectorAll('button'))
    .find(b => (b.textContent || '').includes('我知道了'));
  if (btn) btn.click();
  return 'ok';
})()"""
        )
        deadline = time.time() + max_wait_s
        while time.time() < deadline:
            state = _read_ui_dom_state()
            if state.get("login"):
                break
            if state.get("err"):
                break
            if state.get("hasTable") and not state.get("loading"):
                break
            if not state.get("loading") and state.get("hasTable"):
                break
            time.sleep(0.75)

        if state.get("login") and relogin and attempt < 2:
            try:
                relogin()
            except RuntimeError:
                time.sleep(2)
            continue
        state["require_lesson_text"] = require_lesson_text
        return state

    state["require_lesson_text"] = require_lesson_text
    return state


PARSED_DIR = ROOT / "backend/data/lessons/_parsed_2026-05-01"


def loader_for_parsed_lesson(
    parsed_lesson_id: str,
    lessons_by_code: dict[str, dict],
) -> tuple[dict | None, str | None]:
    """DOCX batch ids are parsed YAML stems; loader indexes by catalog grade_code."""
    parsed = normalize_manifest_code(parsed_lesson_id)
    for catalog in parsed_to_catalog_codes(parsed):
        loader = lessons_by_code.get(normalize_manifest_code(catalog))
        if loader:
            return loader, catalog
    return lessons_by_code.get(parsed), parsed


def expected_parsed_yaml_path(
    *,
    parsed_lesson_id: str | None,
    catalog_code: str | None,
) -> Path | None:
    if catalog_code:
        stem = catalog_to_parsed_code(catalog_code)
    elif parsed_lesson_id:
        stem = normalize_manifest_code(parsed_lesson_id)
    else:
        return None
    path = PARSED_DIR / f"{stem}.yml"
    return path if path.exists() else None


def build_structure_from_lesson(lesson: dict, format_table, sanitize):
    if lesson.get("story_structure_table"):
        return sanitize(format_table(lesson["story_structure_table"]))
    if lesson.get("story_structure_rows"):
        return sanitize({"rows": lesson["story_structure_rows"]})
    return None


def run_qa(
    *,
    gates: set[str],
    schema_dir: Path,
    staging_be: str,
    staging_fe: str,
    token: str | None,
    smoke_only: bool,
    run_ui: bool,
    story_ids: set[int] | None = None,
    structure_pacing_s: float = DEFAULT_STRUCTURE_PACING_S,
) -> dict:
    batch = load_mod("batch", ROOT / "scripts/batch_all_lessons.py")
    eval_mod = load_mod("eval", ROOT / "scripts/eval_lesson_schema.py")
    sync_mod = load_mod("sync", ROOT / "scripts/keypoints_table_sync.py")
    bls = eval_mod.load_bls()

    from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
    from app.services.lesson_loader import get_all_lessons

    grade_paths = sync_mod.build_grade_code_paths()
    lessons_by_id = {l["id"]: l for l in get_all_lessons()}
    lessons_by_code: dict[str, dict] = {}
    for l in get_all_lessons():
        code = normalize_manifest_code(l.get("grade_code") or l.get("lesson_code") or "")
        if code:
            lessons_by_code[code] = l

    per_lesson: list[dict] = []
    failures: list[dict] = []

    # ── L1/L2/L3 per DOCX lesson + loader lessons ─────────────────────────
    docx_gates = gates & {"L1", "L2", "L3"}
    if docx_gates:
        docx_lessons = batch.discover_lessons()
        if smoke_only:
            docx_ids = set(SMOKE_LESSONS)
            docx_lessons = [(lid, p) for lid, p in docx_lessons if lid in docx_ids]

        for lesson_id, docx_path in docx_lessons:
            record: dict = {"lesson_id": lesson_id, "gates": {}}
            kp_eval = eval_mod.eval_keypoints(lesson_id, docx_path, schema_dir, bls)
            loader, catalog_code = loader_for_parsed_lesson(lesson_id, lessons_by_code)
            parsed_code = normalize_manifest_code(lesson_id)
            yaml_file = expected_parsed_yaml_path(parsed_lesson_id=lesson_id, catalog_code=None)
            has_kp_yml = (schema_dir / f"{lesson_id}.keypoints.yml").exists()
            on_disk_table = None
            if yaml_file:
                with open(yaml_file, encoding="utf-8") as f:
                    on_disk_table = (yaml.safe_load(f) or {}).get("story_structure_table")
            has_table = bool(on_disk_table)
            has_ai = bool(loader and loader.get("story_structure_rows") and not on_disk_table)
            tier = classify_lesson(
                grade_code=lesson_id,
                has_keypoints_yml=has_kp_yml,
                has_structure_table=has_table,
                has_ai_rows=has_ai,
                docx_keypoints_available=kp_eval.get("available"),
            )
            record["tier"] = tier.value
            record["parsed_code"] = parsed_code
            record["catalog_code"] = catalog_code
            record["story_id"] = loader["id"] if loader else None

            if "L1" in gates and tier == LessonTier.DOCX_KEYPOINTS:
                ok, issues = gate_l1_pass(kp_eval)
                record["gates"]["L1"] = summarize_gate("L1", ok, issues)
                if not ok:
                    failures.append({"lesson_id": lesson_id, "gate": "L1", "issues": issues})

            if "L2" in gates and tier == LessonTier.DOCX_KEYPOINTS and has_kp_yml:
                issues = []
                with open(schema_dir / f"{lesson_id}.keypoints.yml", encoding="utf-8") as f:
                    kp_schema = yaml.safe_load(f)
                expected = sync_mod.keypoints_to_table(kp_schema)
                on_disk = None
                yaml_path = None
                for path in grade_paths.get(normalize_manifest_code(lesson_id), []):
                    with open(path, encoding="utf-8") as f:
                        data = yaml.safe_load(f) or {}
                    if data.get("story_structure_table") is not None:
                        on_disk = data["story_structure_table"]
                        yaml_path = str(path)
                        if data.get("story_structure_rows"):
                            issues.append("story_structure_rows still present")
                        break
                if on_disk is None:
                    issues.append("no yaml story_structure_table")
                elif table_fingerprint(expected) != table_fingerprint(on_disk):
                    issues.append("fingerprint mismatch")
                ok = len(issues) == 0
                record["gates"]["L2"] = summarize_gate("L2", ok, issues)
                record["yaml_path"] = yaml_path
                if not ok:
                    failures.append({"lesson_id": lesson_id, "gate": "L2", "issues": issues})

            if "L3" in gates and loader:
                struct = build_structure_from_lesson(loader, _format_yaml_structure_table, _sanitize_structure_for_client)
                yaml_file = expected_parsed_yaml_path(
                    parsed_lesson_id=lesson_id,
                    catalog_code=catalog_code,
                )
                if yaml_file:
                    record.setdefault("yaml_path", str(yaml_file))
                if yaml_file and tier == LessonTier.DOCX_KEYPOINTS:
                    with open(yaml_file, encoding="utf-8") as f:
                        file_data = yaml.safe_load(f) or {}
                    file_table = file_data.get("story_structure_table")
                    loader_table = loader.get("story_structure_table")
                    issues_catalog: list[str] = []
                    if not file_table:
                        issues_catalog.append("no on-disk story_structure_table")
                    elif not loader_table:
                        issues_catalog.append("loader missing story_structure_table")
                    elif table_fingerprint(file_table) != table_fingerprint(loader_table):
                        issues_catalog.append("loader story_structure_table != on-disk yaml")
                    ok_catalog = len(issues_catalog) == 0
                    record["gates"]["L3_catalog"] = summarize_gate("L3_catalog", ok_catalog, issues_catalog)
                    if not ok_catalog:
                        failures.append(
                            {"lesson_id": lesson_id, "gate": "L3_catalog", "issues": issues_catalog}
                        )
                if struct:
                    issues = verify_interaction_profile_contract(struct)
                    yaml_checkbox_cells = (
                        count_checkbox_cells_in_table(on_disk_table) if on_disk_table else 0
                    )
                    issues.extend(
                        gate_l3_mode_expectation(
                            tier,
                            lesson_id,
                            struct.get("interaction_profile") or {},
                            docx_blanks=kp_eval.get("docx_blanks"),
                            yaml_checkbox_cells=yaml_checkbox_cells,
                        )
                    )
                    profile = struct.get("interaction_profile") or {}
                    record["profile"] = profile
                    ok = len(issues) == 0
                    record["gates"]["L3"] = summarize_gate("L3", ok, issues)
                    if not ok:
                        failures.append({"lesson_id": lesson_id, "gate": "L3", "issues": issues})
                elif tier not in (LessonTier.NO_KEYPOINTS_DOCX, LessonTier.NO_STRUCTURE):
                    record["gates"]["L3"] = summarize_gate("L3", False, ["no structure in loader"])
                    failures.append({"lesson_id": lesson_id, "gate": "L3", "issues": ["no structure"]})

            per_lesson.append(record)

    # ── L3 all loader lessons (including non-docx batch) ──────────────────
    if "L3" in gates and not smoke_only:
        for lesson in get_all_lessons():
            code = normalize_manifest_code(lesson.get("grade_code") or "")
            if any(r.get("lesson_id") == code for r in per_lesson):
                continue
            struct = build_structure_from_lesson(lesson, _format_yaml_structure_table, _sanitize_structure_for_client)
            if not struct:
                continue
            tier = classify_lesson(
                grade_code=code,
                has_keypoints_yml=False,
                has_structure_table=bool(lesson.get("story_structure_table")),
                has_ai_rows=bool(lesson.get("story_structure_rows")),
            )
            issues = verify_interaction_profile_contract(struct)
            issues.extend(gate_l3_mode_expectation(tier, code, struct.get("interaction_profile") or {}))
            if issues:
                failures.append({"lesson_id": code, "story_id": lesson["id"], "gate": "L3", "issues": issues})

    # ── L4 staging API ────────────────────────────────────────────────────
    staging_token = token
    if ("L4" in gates or "L5" in gates) and not staging_token:
        staging_token = login_staging(staging_be)

    stories: list[dict] = []
    if "L4" in gates or "L5" in gates:
        page = 1
        while True:
            data = http_json(f"{staging_be}/api/stories?page={page}&page_size=300", token=staging_token)
            stories.extend(data["stories"])
            if len(stories) >= data["total"]:
                break
            page += 1
        if smoke_only:
            smoke_ids: set[int] = set()
            for code in SMOKE_LESSONS:
                loader, _ = loader_for_parsed_lesson(code, lessons_by_code)
                if loader:
                    smoke_ids.add(loader["id"])
                elif code in lessons_by_code:
                    smoke_ids.add(lessons_by_code[code]["id"])
            stories = [s for s in stories if s["id"] in smoke_ids]
        if story_ids:
            stories = [s for s in stories if s["id"] in story_ids]

    staging_records: list[dict] = []
    structure_calls = 0

    def _pace_structure_fetch() -> None:
        nonlocal structure_calls
        if structure_pacing_s > 0 and structure_calls > 0:
            time.sleep(structure_pacing_s)
        structure_calls += 1

    if "L4" in gates:
        for s in stories:
            sid = s["id"]
            code = s.get("grade_code") or ""
            issues: list[str] = []
            _pace_structure_fetch()
            try:
                remote = fetch_staging_structure(staging_be, sid, staging_token)
            except urllib.error.HTTPError as e:
                issues.append(f"HTTP {e.code}")
                failures.append({"story_id": sid, "grade_code": code, "gate": "L4", "issues": issues})
                staging_records.append({"id": sid, "grade_code": code, "gates": {"L4": summarize_gate("L4", False, issues)}})
                continue

            issues.extend(verify_interaction_profile_contract(remote))
            local = lessons_by_id.get(sid)
            tier = LessonTier.NO_STRUCTURE
            if local:
                tier = classify_lesson(
                    grade_code=code,
                    has_keypoints_yml=bool(local.get("story_structure_table")),
                    has_structure_table=bool(local.get("story_structure_table")),
                    has_ai_rows=bool(local.get("story_structure_rows")),
                )
                local_struct = build_structure_from_lesson(
                    local, _format_yaml_structure_table, _sanitize_structure_for_client
                )
                if local_struct:
                    lp = local_struct.get("interaction_profile") or {}
                    rp = remote.get("interaction_profile") or {}
                    for key in ("mode", "layout", "fill_blank_count", "checkbox_count"):
                        if lp.get(key) != rp.get(key):
                            issues.append(f"profile.{key} local={lp.get(key)} remote={rp.get(key)}")
                    if local.get("story_structure_table"):
                        if remote.get("layout") != local_struct.get("layout"):
                            issues.append("layout mismatch vs local")

            issues.extend(
                gate_l3_mode_expectation(tier, code, remote.get("interaction_profile") or {})
            )
            ok = len(issues) == 0
            rec = {
                "id": sid,
                "grade_code": code,
                "tier": tier.value,
                "profile": remote.get("interaction_profile"),
                "gates": {"L4": summarize_gate("L4", ok, issues)},
            }
            staging_records.append(rec)
            if not ok:
                failures.append({"story_id": sid, "grade_code": code, "gate": "L4", "issues": issues})

    # ── L5 staging UI ─────────────────────────────────────────────────────
    if "L5" in gates and run_ui:
        if not BROWSE.exists():
            raise RuntimeError(f"browse not found: {BROWSE}")

        def relogin() -> None:
            last_err: RuntimeError | None = None
            for _ in range(3):
                try:
                    ensure_browser_login(staging_fe, fresh=True)
                    assert_browser_logged_in(staging_fe)
                    return
                except RuntimeError as exc:
                    last_err = exc
                    time.sleep(3)
            raise RuntimeError(f"browser relogin failed after 3 attempts: {last_err}")

        relogin()
        total = len(stories)
        for idx, s in enumerate(stories):
            if idx > 0 and idx % L5_RELOGIN_EVERY == 0:
                relogin()
            sid = s["id"]
            code = s.get("grade_code") or ""
            require_lt = normalize_manifest_code(code) in IMAGE_TEXT_LESSONS
            _pace_structure_fetch()
            try:
                remote = fetch_staging_structure(staging_be, sid, staging_token)
            except urllib.error.HTTPError as e:
                issues = [f"structure HTTP {e.code}"]
                rec = next(
                    (r for r in staging_records if r["id"] == sid),
                    {"id": sid, "grade_code": code, "gates": {}},
                )
                rec.setdefault("gates", {})["L5"] = summarize_gate("L5", False, issues)
                if rec not in staging_records:
                    staging_records.append(rec)
                failures.append({"story_id": sid, "grade_code": code, "gate": "L5", "issues": issues})
                print(f"L5 {idx + 1}/{total} id={sid} {code} FAIL", flush=True)
                continue
            profile = remote.get("interaction_profile") or {}
            dom = check_ui_page(sid, staging_fe, require_lt, relogin=relogin)
            ok, issues = ui_pass_from_dom(dom, profile, require_lesson_text=require_lt)
            if not ok and l5_issues_retriable(issues):
                try:
                    relogin()
                    dom = check_ui_page(sid, staging_fe, require_lt, relogin=relogin)
                    ok, issues = ui_pass_from_dom(dom, profile, require_lesson_text=require_lt)
                except RuntimeError as exc:
                    issues = [*issues, f"flake retry relogin failed: {exc}"]
                    ok = False
            rec = next((r for r in staging_records if r["id"] == sid), {"id": sid, "grade_code": code, "gates": {}})
            rec.setdefault("gates", {})["L5"] = summarize_gate("L5", ok, issues)
            rec["profile"] = profile
            if rec not in staging_records:
                staging_records.append(rec)
            if not ok:
                failures.append({"story_id": sid, "grade_code": code, "gate": "L5", "issues": issues})
            print(f"L5 {idx + 1}/{total} id={sid} {code} {'PASS' if ok else 'FAIL'}", flush=True)

    return {
        "gates_run": sorted(gates),
        "smoke_only": smoke_only,
        "per_lesson_docx": per_lesson,
        "staging": staging_records,
        "failures": failures,
        "summary": {
            "docx_lessons_checked": len(per_lesson),
            "staging_checked": len(staging_records),
            "failure_count": len(failures),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Story structure QA (L1–L5)")
    parser.add_argument("--all", action="store_true", help="Run L1,L2,L3,L4,L5")
    parser.add_argument("--smoke", action="store_true", help="Smoke lessons only")
    parser.add_argument("--gates", default="", help="Comma-separated L1,L2,L3,L4,L5")
    parser.add_argument("--schema-dir", default=str(DEFAULT_SCHEMA_DIR))
    parser.add_argument("--staging-url", default=DEFAULT_STAGING)
    parser.add_argument("--staging-fe", default=DEFAULT_STAGING_FE)
    parser.add_argument("--token")
    parser.add_argument("--no-ui", action="store_true", help="Skip L5 browser even if requested")
    parser.add_argument("--story-ids", default="", help="Comma-separated story ids (L4/L5 subset)")
    parser.add_argument(
        "--structure-pacing-s",
        type=float,
        default=DEFAULT_STRUCTURE_PACING_S,
        help="Sleep seconds between staging GET /structure calls (0=off)",
    )
    parser.add_argument("--report", default=str(REPORT_PATH))
    args = parser.parse_args()

    if args.all:
        gates = {"L1", "L2", "L3", "L4", "L5"}
    elif args.gates:
        gates = {g.strip().upper() for g in args.gates.split(",") if g.strip()}
    elif args.smoke:
        gates = {"L1", "L2", "L3", "L4", "L5"}
    else:
        gates = {"L1", "L2", "L3"}

    story_ids = {int(x.strip()) for x in args.story_ids.split(",") if x.strip()} or None

    report = run_qa(
        gates=gates,
        schema_dir=Path(args.schema_dir),
        staging_be=args.staging_url,
        staging_fe=args.staging_fe,
        token=args.token,
        smoke_only=args.smoke,
        run_ui="L5" in gates and not args.no_ui,
        story_ids=story_ids,
        structure_pacing_s=args.structure_pacing_s,
    )

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 72)
    print("STORY STRUCTURE QA")
    print(f"Gates: {', '.join(report['gates_run'])}  smoke={report['smoke_only']}")
    print(f"DOCX lessons: {report['summary']['docx_lessons_checked']}")
    print(f"Staging:      {report['summary']['staging_checked']}")
    print(f"Failures:     {report['summary']['failure_count']}")
    if report["failures"]:
        print("\nFailed:")
        for f in report["failures"][:30]:
            print(f"  {f}")
        if len(report["failures"]) > 30:
            print(f"  ... +{len(report['failures']) - 30} more")
    print(f"\nReport: {report_path}")
    print(f"Standard: docs/qa/story-structure-verification-standard.md")

    return 1 if report["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
