"""yml 形狀棘輪（#2843）—— 同一個模組的每一課，形狀只准變得更一致。

## 為什麼是棘輪而不是 `== 1`

同一個模組的課本來就會有合理的形狀差異：有的課有附錄、有的沒有；
文言文課有 `classical_text` 白話課沒有。硬要求「每課形狀完全一樣」會恆紅，
紅久了就沒人看，那條門等於死掉。

棘輪只保證**不再變差**：形狀數 <= 基準。想降就更新基準，想升要有人解釋。

## 基準怎麼來的

`qa/yml-shape/baseline.json`，由 `scripts/yml_shape_report.py --json` 產出。
2026-08-21 收攏註解欄位之後的數字（收攏前是 606，之後 416）。

## 這條門抓得到什麼

抓「有人又開始發明新的 top-level 欄位名」。那正是 597 個 key-shape 的成因：
LLM 每抽一課自己想一個欄位名 → 消費端 `.get("passage")` 回 None →
**不報錯、其他門全綠、學生看不到**。
"""
from __future__ import annotations

import json
import pathlib

import pytest
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
BASELINE = REPO_ROOT / "qa" / "yml-shape" / "baseline.json"
HEADER_KEYS = {"lesson_uid", "version_id", "section_no"}


def _payload(data: dict, stem: str):
    """跟 yml_shape_report.py 同一套取法。

    ⚠️ 這裡刻意重寫而不是 import —— 不是為了複製邏輯，是因為 scripts/ 不在
    backend 的 import path 上。若哪天兩邊漂開，下面的「總數對得上基準」那條
    會先紅出來，不會靜默失準。
    """
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
        if isinstance(only, list) and only and isinstance(only[0], dict):
            return only[0]
    return rest


def _measure() -> dict[str, int]:
    shapes: dict[str, set] = {}
    for version_dir in sorted(LESSONS.glob("L*/v3")):
        for path in sorted(version_dir.glob("*.yml")):
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            # 帶 slug 的重複大題（#2916）要跟本體算同一個模組，
            # 否則每個 slug 都變成一個「只有 1 種形狀」的假模組，形狀棘輪就形同虛設
            module_name = path.stem.partition(".")[0]
            body = _payload(data, module_name)
            if isinstance(body, dict):
                # ⛔ 定址欄位不進形狀簽章（#2916）。`slug` 每份都有，`text_ref`
                #    只有引用型的節有（課文自己沒有、跨篇的是清單）——
                #    於是同一個模組多出「有/沒有 text_ref」兩種變體，
                #    棘輪讀成「抽取器又發明了新欄位名」，而那不是它在盯的東西。
                #    排除之後數字必須回到基準；沒回到就是真的有形狀漂移。
                shapes.setdefault(module_name, set()).add(
                    frozenset(body.keys() - {"slug", "text_ref"}))
    return {k: len(v) for k, v in shapes.items()}


@pytest.fixture(scope="module")
def baseline() -> dict:
    assert BASELINE.is_file(), f"基準檔不存在：{BASELINE}"
    return json.loads(BASELINE.read_text(encoding="utf-8"))["modules"]


@pytest.fixture(scope="module")
def measured() -> dict[str, int]:
    return _measure()


def test_scan_actually_found_lessons(measured):
    """掃描前提 —— 少了這條，掃不到檔案時下面每一條都會恆綠。"""
    assert len(measured) >= 20, f"只掃到 {len(measured)} 個模組，掃描壞了"
    assert sum(measured.values()) > 0


def test_no_module_gets_shapier(baseline, measured):
    """棘輪本體：每個模組的形狀數只准降不准升。"""
    worse = {
        module: (baseline[module]["inner_shapes"], count)
        for module, count in measured.items()
        if module in baseline and count > baseline[module]["inner_shapes"]
    }
    assert not worse, (
        "以下模組的 yml 形狀變得更不一致了（有人又發明了新的 top-level 欄位名）：\n"
        + "\n".join(f"  {m}: 基準 {b} → 現在 {a}" for m, (b, a) in sorted(worse.items()))
        + "\n\n真的是刻意的話，跑 `python3 scripts/yml_shape_report.py --json > "
          "qa/yml-shape/baseline.json` 更新基準，並在 PR 說明為什麼。"
    )


def test_every_baselined_module_still_exists(baseline, measured):
    """基準裡有、現在量不到 —— 那是模組整個消失了，比形狀變差更嚴重。"""
    missing = sorted(set(baseline) - set(measured))
    assert not missing, f"基準裡的模組現在量不到：{missing}"


def test_notes_are_not_scattered_back_to_top_level(measured):
    """註解欄位不准再散回 payload 的 top-level。

    用**數量**斷言而不是「至少有一個模組乾淨」—— 今天稍早才踩過一次：
    只驗「有一個是對的」，另外兩個壞的照樣過關。

    這裡數的是「散在 top-level 的註解型欄位總數」，門檻取收攏後的實測值。
    claimed 模組（spotlight / keypoints / key_reading）沒被收攏過，
    它們的註解仍在 top-level，所以門檻不是 0。
    """
    import re

    noteish = re.compile(r"(note|說明|備註)$|^_|_ref$|errata|carrier|scope", re.IGNORECASE)
    # ⛔ `slug` / `text_ref` 是**定址**不是註解，不算「散在 top-level 的說明文字」。
    #    `_ref$` 這條原本是抓 `xxx_ref` 那種夾帶的參照說明，但 #2916 之後
    #    每一份 yml 都有 `text_ref` —— 1611 個檔全部命中，計數從 ~900 跳到 2153。
    #    ⚠️ 正確的處理是把它們排除，不是把上限調高：調高上限會讓這個棘輪
    #    對「真的又散出 1200 個註解欄位」也保持沉默。
    ADDRESSING = {"slug", "text_ref"}
    scattered = 0
    for version_dir in sorted(LESSONS.glob("L*/v3")):
        for path in sorted(version_dir.glob("*.yml")):
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            # 檔名是 `{模組}.{slug}.yml`（#2916）—— 取模組名，
            # 用整個 stem 的話 `_payload` 找不到 body，整支測試靜靜地數 0。
            body = _payload(data, path.stem.partition(".")[0])
            if not isinstance(body, dict):
                continue
            for key, value in body.items():
                if key == "notes" or key in ADDRESSING or isinstance(value, dict):
                    continue
                if noteish.search(str(key)):
                    scattered += 1

    # 2026-08-21 收攏後實測。claimed 三個模組尚未收攏，故非 0。
    LIMIT = 900
    assert scattered <= LIMIT, (
        f"散在 top-level 的註解型欄位有 {scattered} 個，超過基準 {LIMIT}。\n"
        "註解應該收進 payload 的 `notes` 物件，不要每課發明一個新的 top-level key。\n"
        "跑 `python3 scripts/yml_shape_normalize.py --module <模組>` 收攏。"
    )
