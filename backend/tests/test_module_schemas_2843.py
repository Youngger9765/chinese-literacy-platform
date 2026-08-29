"""每份 yml 都要符合它那個模組的 schema（#2843）。

Young 2026-08-21 的三項期待之一：「**所有 yml 都應該要有 schema 檢查**」。

## 這條門真正在擋的是什麼

不是「欄位缺了」——那是內容問題，由 #2836 的缺口宣告管。

這條擋的是 **`additionalProperties: false`**：抽取器又發明一個新的 top-level 欄位名。
那正是 597 個 key-shape 的成因，而它的症狀是**沒有症狀** ——
消費端 `.get("passage")` 回 None，不報錯、其他門全綠、學生看不到。

## schema 是產出來的，不是手寫的

`scripts/build_module_schemas.py` 從實測資料長出來，所以現況 100% 通過。
手寫的話 175 課會一起紅，然後就得回頭改 schema 而不是改資料 ——
那等於 schema 被資料牽著走，門就沒意義了。

## 三個模組只警告不擋

`spotlight` / `keypoints`（@stgst）、`key_reading`（@if-else-master）正在被改。
現在硬擋等於在他們的工作區丟紅燈。schema 照樣產（Young 要「所有模組」），
`x-enforcement: warn`，等他們收完自己改成 error。
"""
from __future__ import annotations

import collections
import json
import pathlib

import pytest
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
SCHEMAS = REPO_ROOT / "specs" / "modules" / "schemas"
HEADER_KEYS = {"lesson_uid", "version_id", "section_no"}


def _payload(data: dict, stem: str):
    for candidate in (stem, stem.rstrip("s"), stem + "s"):
        value = data.get(candidate)
        if isinstance(value, dict):
            return value
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return value[0]
    rest = {k: v for k, v in data.items() if k not in HEADER_KEYS}
    if len(rest) == 1:
        only = next(iter(rest.values()))
        if isinstance(only, dict):
            return only
    return rest


@pytest.fixture(scope="module")
def schemas() -> dict[str, dict]:
    assert SCHEMAS.is_dir(), f"schema 目錄不存在：{SCHEMAS}"
    out = {p.stem.replace(".schema", ""): json.loads(p.read_text(encoding="utf-8"))
           for p in SCHEMAS.glob("*.schema.json")}
    assert out, "schema 目錄是空的"
    return out


@pytest.fixture(scope="module")
def violations(schemas):
    """回傳 {模組: [(uid, 未知欄位)]} 與 {模組: [(uid, 缺的必填)]}。"""
    unknown = collections.defaultdict(list)
    missing = collections.defaultdict(list)
    scanned = 0
    for version_dir in sorted(LESSONS.glob("L*/v3")):
        uid = version_dir.parent.name
        for path in sorted(version_dir.glob("*.yml")):
            # 重複出現的大題（#2916）：第二輪以後的檔名帶 slug，例如
            # `key_reading.m7qxv.yml`。stem 會是 `key_reading.m7qxv`，
            # 直接查 schema 會查不到 → **靜默跳過**，那些檔案就永遠不受 schema 管
            # （2026-08-24 dry run 實測）。所以查之前先把 slug 剝掉。
            module_name = path.stem.partition(".")[0]
            schema = schemas.get(module_name)
            if schema is None:
                continue
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            body = _payload(data, module_name)
            if not isinstance(body, dict):
                continue
            scanned += 1
            allowed = set(schema.get("properties", {}))
            extra = sorted(set(body) - allowed)
            if extra:
                # ⚠️ key 要用 module_name 不是 path.stem —— 下面的 `_enforced` 比對的是
                #    模組名，用 `key_reading.m7qxv` 當 key 會被濾掉而靜默放行
                #    （2026-08-24：我第一版只修了查 schema 那一半，mutation 才抓到）
                unknown[module_name].append((f"{uid}:{path.name}", extra))
            absent = sorted(set(schema.get("required", [])) - set(body))
            if absent:
                missing[module_name].append((f"{uid}:{path.name}", absent))
    return {"unknown": unknown, "missing": missing, "scanned": scanned}


def _enforced(schemas) -> set[str]:
    return {m for m, s in schemas.items() if s.get("x-enforcement") != "warn"}


def test_the_scan_actually_read_files(violations, schemas):
    """掃描前提 —— 少了這條，讀不到檔時下面每一條都會恆綠。"""
    assert violations["scanned"] >= 1500, f"只驗到 {violations['scanned']} 份，掃描壞了"
    assert len(schemas) >= 20, f"只載到 {len(schemas)} 份 schema"


def test_no_invented_field_names(violations, schemas):
    """🔴 主條件：不准冒出 schema 沒宣告的欄位名。

    這是 additionalProperties: false 的實際執行點，也是這條門存在的理由。
    """
    enforced = _enforced(schemas)
    offenders = {m: v for m, v in violations["unknown"].items() if m in enforced}
    total = sum(len(v) for v in offenders.values())
    assert not offenders, (
        f"{total} 份 yml 出現 schema 沒宣告的欄位名（抽取器又自己發明了名字）：\n"
        + "\n".join(
            f"  {m}: " + ", ".join(f"{uid}({'/'.join(fields)})" for uid, fields in items[:4])
            + (f" …另外 {len(items)-4} 課" if len(items) > 4 else "")
            for m, items in sorted(offenders.items())
        )
        + "\n\n是刻意加的欄位 → 跑 `python3 scripts/build_module_schemas.py` 重產 schema，"
          "\n並在 PR 說明為什麼。⛔ 不要為了讓門變綠就重產 —— 先想清楚那個欄位該不該存在。"
    )


def test_required_fields_present(violations, schemas):
    """必填欄位不可缺。門檻是 ≥90% 課都有，所以缺了通常是真的漏抽。"""
    enforced = _enforced(schemas)
    offenders = {m: v for m, v in violations["missing"].items() if m in enforced}
    assert not offenders, (
        "以下 yml 缺了 schema 宣告的必填欄位：\n"
        + "\n".join(
            f"  {m}: " + ", ".join(f"{uid}({'/'.join(f)})" for uid, f in items[:4])
            for m, items in sorted(offenders.items())
        )
    )


def test_claimed_modules_are_warn_not_error(schemas):
    """有人在改的模組必須是 warn —— 否則會在他們的工作區丟紅燈。

    用數量斷言而不是「至少有一個是 warn」：三個都要，少一個就是有人被誤擋。
    """
    expected = {"spotlight", "keypoints", "key_reading"}
    actual = {m for m, s in schemas.items() if s.get("x-enforcement") == "warn"}
    assert actual == expected, (
        f"warn 名單對不上：預期 {sorted(expected)}，實際 {sorted(actual)}。\n"
        "有人收完工作要把自己的模組改成 error，改的時候也要更新這條斷言。"
    )
