#!/usr/bin/env python3
"""從實測資料產出每個模組的 JSON Schema（#2843）。

## 為什麼是「產出」不是「手寫」

手寫的 schema 是憑想像的：寫完 175 課一起紅，紅了就得回去改 schema 而不是改資料
—— 等於 schema 被資料牽著走，那條門就沒有意義了。

從實測長出來的 schema 反過來：**現況全過，未來的新發明會紅**。

## 關鍵設計：`additionalProperties: false` + 列出所有已觀測欄位

這兩個放在一起才有用：

- 列出所有已觀測欄位 → 現在的 2019 份檔全部通過，門不會一上線就恆紅
- `additionalProperties: false` → **任何新冒出來的欄位名立刻紅**

而「新冒出來的欄位名」正是 597 個 key-shape 的成因：抽取器每課自己想一個名字，
消費端 `.get("passage")` 回 None，不報錯、其他門全綠、學生看不到。

## required 的門檻是「每一課都有」，不是 90%

第一版訂 0.9，門自己抓到問題：90% 意味著剩下 10% 必然缺，於是 required 擋的是
**合理缺項**而不是**回歸** —— `full_text_annotate` 一上線就紅了一批只是沒有
`inline_marked_terms` 的課。

必填的意思是「少了就是出事」，所以門檻只能是全體。90% 那個概念仍然有用，
但它是描述性統計（`x-core-90pct`，給人看模組骨架長什麼樣），不是門的判準。

## 認領模組

`spotlight` / `keypoints` / `key_reading` 照樣產 schema（Young 要「所有模組」），
但標 `x-enforcement: warn`，門不擋它們 —— @stgst 與 @if-else-master 正在改，
現在擋等於在他們的工作區丟紅燈。等他們收完再由他們自己轉成 error。

用法：
    python3 scripts/build_module_schemas.py            # 產出到 specs/modules/schemas/
    python3 scripts/build_module_schemas.py --check    # 只比對，不寫（CI 用）
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
OUT_DIR = REPO_ROOT / "specs" / "modules" / "schemas"
HEADER_KEYS = {"lesson_uid", "version_id", "section_no"}

#: 有人正在改的模組 —— 照樣產 schema，但門只警告不擋
CLAIMED = {
    "spotlight": "@stgst",
    "keypoints": "@stgst",
    "key_reading": "@if-else-master",
}

#: required 的門檻 —— **必須是每一課都有**，不是 90%。
#:
#: 一開始訂 0.9，結果門自己抓到問題：90% 意味著剩下 10% 必然缺，
#: 於是 required 擋的是「合理缺項」而不是「回歸」，一上線就紅一批。
#: 必填的意思是「少了就是出事」，所以門檻只能是全體。
#: 90% 那個概念仍然有用，但它是「核心欄位」的描述性統計（見 x-core-90pct），
#: 不是門的判準。
REQUIRED_RATIO = 1.0
CORE_RATIO = 0.9

JSON_TYPE = {
    str: "string", int: "integer", float: "number",
    bool: "boolean", list: "array", dict: "object", type(None): "null",
}


def payload_of(data: dict, stem: str):
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


def observe() -> dict[str, dict]:
    """走一遍所有 yml，記錄每個模組出現過哪些欄位、各是什麼型別。"""
    seen: dict[str, dict] = collections.defaultdict(
        lambda: {"n": 0, "fields": collections.Counter(), "types": collections.defaultdict(set)}
    )
    for version_dir in sorted(LESSONS.glob("L*/v3")):
        for path in sorted(version_dir.glob("*.yml")):
            # 底線前綴 = 衍生檔不是模組（_manifest.yml），不該有自己的 schema
            if path.stem.startswith("_"):
                continue
            # 檔名是 `{模組}.{自己的 slug}.yml`（#2916），模組名是第一段。
            #
            # ⚠️ 這裡本來直接用 `path.stem`，改名之後那是 `comprehension.34pme` ——
            #    重產會吐出 **1627 份 per-file schema** 而不是 24 份 per-module。
            #    每份只由一個檔長成，等於完全沒有約束力，而檔案數看起來還「更完整」。
            #    2026-08-25 實際跑出來過，靠「產出份數」才看出不對。
            module = path.stem.partition(".")[0]
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            body = payload_of(data, module)
            if not isinstance(body, dict):
                continue
            entry = seen[module]
            entry["n"] += 1
            for key, value in body.items():
                entry["fields"][key] += 1
                entry["types"][key].add(JSON_TYPE.get(type(value), "string"))
    return seen


def build_schema(module: str, entry: dict) -> dict:
    n = entry["n"]
    required = sorted(k for k, c in entry["fields"].items() if c >= REQUIRED_RATIO * n)
    core_90 = sorted(k for k, c in entry["fields"].items() if c >= CORE_RATIO * n)
    properties = {}
    for key in sorted(entry["fields"]):
        types = sorted(entry["types"][key])
        properties[key] = {
            "type": types[0] if len(types) == 1 else types,
            "x-seen-in": f"{entry['fields'][key]}/{n}",
        }
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"lingoleap/module/{module}",
        "title": f"{module} module payload",
        "description": (
            f"從 {n} 份實測 yml 長出來，不是手寫的。"
            "required = 每一課都有的欄位（少了就是回歸）；"
            "properties 列出所有已觀測欄位，配合 additionalProperties: false —— "
            "現況全過，任何新發明的欄位名會紅。"
        ),
        "type": "object",
        "required": required,
        "properties": properties,
        # 這一行是整份 schema 的重點
        "additionalProperties": False,
        "x-lessons-observed": n,
        # 描述性統計，不是門的判準 —— 給人看「這個模組的骨架長什麼樣」
        "x-core-90pct": core_90,
    }
    if module in CLAIMED:
        schema["x-enforcement"] = "warn"
        schema["x-owner"] = CLAIMED[module]
        schema["x-why-warn"] = (
            f"{CLAIMED[module]} 正在改這個模組，現在硬擋等於在他的工作區丟紅燈。"
            "等他收完再由他自己改成 error。"
        )
    else:
        schema["x-enforcement"] = "error"
    return schema


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只比對不寫（CI 用）")
    args = ap.parse_args()

    seen = observe()
    if not seen:
        print(f"🔴 在 {LESSONS} 底下找不到任何模組 yml", file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    drifted, written = [], 0
    for module, entry in sorted(seen.items()):
        schema = build_schema(module, entry)
        target = OUT_DIR / f"{module}.schema.json"
        text = json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if args.check:
            if not target.is_file() or target.read_text(encoding="utf-8") != text:
                drifted.append(module)
        else:
            target.write_text(text, encoding="utf-8")
            written += 1

    if args.check:
        if drifted:
            print("🔴 以下模組的 schema 跟實測資料對不上（資料改了但 schema 沒重產）：")
            for m in drifted:
                print(f"    {m}")
            print("\n跑 `python3 scripts/build_module_schemas.py` 重產，並在 PR 說明改了什麼。")
            return 1
        print(f"✅ {len(seen)} 個模組的 schema 都跟實測資料一致")
        return 0

    enforced = sum(1 for m in seen if m not in CLAIMED)
    print(f"✅ 產出 {written} 份 schema → {OUT_DIR.relative_to(REPO_ROOT)}")
    print(f"   強制 {enforced} 個 · 僅警告 {len(seen) - enforced} 個（有人在改）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
