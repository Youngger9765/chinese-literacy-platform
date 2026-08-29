#!/usr/bin/env python3
"""量抽取任務的重跑一致率（#2865 ⑥a）。

## 為什麼需要它

抽取流程有兩個模型環節，兩個都要量：

| 環節 | 量的工具 | 狀態 |
|---|---|---|
| ③a 判有哪幾個大題 | `eval_overview_repeatability.py` | 已量：大題集合 3/3 全同 |
| **⑥a 抽內容** | **這一支** | 在此之前**完全沒量** —— 只跑過 1 課 1 次 |

「跑過一次、結果看起來對」不是穩定度。換 prompt、換 model、換課型都可能飄，
而沒有數字就沒有比較基準。

## 它比什麼

一致率要分層看 —— 兩份輸出可以「題數相同」卻「內容全不一樣」：

    題數        最粗，但漏抽/多抽先在這裡現形
    題號集合    順序無關的比對
    答案        每題的 word / answer
    解釋逐字    最嚴，也最容易因為潤稿而不一致
    欄位集合    有沒有人多抽或少抽欄位

⛔ **只報一個總數會騙人。** 「3 份輸出一致」如果只比題數，
那三份可能抄了三種不同的解釋。

## 這支不呼叫模型

跑抽取的是 agent（要模型），這支只做比對 —— 比對邏輯必須決定性，
否則「一致率」這個數字本身就不可信。

## 用法

    python3 scripts/eval_extract_repeatability.py --module vocab_definitions A.yml B.yml C.yml
    python3 scripts/eval_extract_repeatability.py --module vocab_definitions *.yml --baseline backend/data/lessons/L0072/v3/vocab_definitions.yml

exit 0 = 每一層都完全一致
exit 1 = 有層級不一致（不代表哪份是錯的，代表這個環節會飄）
exit 2 = 材料不齊
"""
from __future__ import annotations

import argparse
import collections
import pathlib
import sys

import yaml


def load(path: pathlib.Path, module: str) -> dict | None:
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return None
    if not isinstance(doc, dict):
        return None
    return doc.get(module, doc)


def items_of(body: dict) -> list:
    for k in ("items", "questions", "videos"):
        v = body.get(k)
        if isinstance(v, list):
            return v
    return []


def answer_of(it: dict) -> str:
    for k in ("word", "answer"):
        v = it.get(k)
        if isinstance(v, str):
            return v.strip()
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+", type=pathlib.Path)
    ap.add_argument("--module", required=True)
    ap.add_argument("--baseline", type=pathlib.Path,
                    help="既有的那份，用來看模型跟現況差多少（不影響一致率）")
    args = ap.parse_args()

    if len(args.runs) < 2:
        print("⛔ 至少要兩份輸出才量得出一致率", file=sys.stderr)
        return 2

    bodies = {}
    for p in args.runs:
        b = load(p, args.module)
        if b is None:
            print(f"⛔ 讀不到或格式不對：{p}", file=sys.stderr)
            return 2
        bodies[p.name] = b

    n = len(bodies)
    print(f"── {args.module} 重跑一致率（{n} 份獨立輸出）──")

    layers: list[tuple[str, dict[str, object]]] = []
    for name, b in bodies.items():
        its = items_of(b)
        layers.append((name, {
            "題數": len(its),
            "題號集合": tuple(sorted(i.get("index") for i in its
                                    if isinstance(i, dict) and i.get("index") is not None)),
            "答案": tuple(answer_of(i) for i in sorted(
                (x for x in its if isinstance(x, dict)),
                key=lambda x: x.get("index") or 0)),
            "解釋逐字": tuple(str(i.get("definition") or "").strip() for i in sorted(
                (x for x in its if isinstance(x, dict)),
                key=lambda x: x.get("index") or 0)),
            "欄位集合": tuple(sorted(b.keys())),
            # notes 是自由文字註記，飄不飄跟教學內容對不對是兩回事 ——
            # 分開報，不要混進「一致率」讓數字失真，也不要不報讓人以為完全一致。
            "notes 的鍵": tuple(sorted((b.get("notes") or {}).keys()))
                          if isinstance(b.get("notes"), dict) else (),
            "notes 逐字": yaml.safe_dump(b.get("notes"), allow_unicode=True, sort_keys=True)
                          if b.get("notes") is not None else "",
        }))

    #: 教學內容層 —— 這些不一致就是真的會飄
    CONTENT = ("題數", "題號集合", "答案", "解釋逐字", "欄位集合")
    #: 註記層 —— 自由文字，飄了不影響學生看到的東西，但要據實報
    ANNOT = ("notes 的鍵", "notes 逐字")

    worst = 0
    for layer in CONTENT + ANNOT:
        if layer == ANNOT[0]:
            print("  ── 以上是教學內容。以下是自由註記，飄了不影響學生 ──")
        vals = collections.Counter(v[layer] for _, v in layers)
        same = len(vals) == 1
        # ⛔ 註記層不計入 exit code —— 讓它擋人的話這道門會變成恆紅，
        #    紅久了大家學會忽略，真正的內容不一致就跟著被忽略。
        if layer in CONTENT:
            worst = max(worst, 0 if same else 1)
        mark = "✅" if same else "🔴"
        if layer == "題數":
            detail = " / ".join(str(v[layer]) for _, v in layers)
        elif same:
            detail = f"{n}/{n} 相同"
        else:
            detail = f"{len(vals)} 種寫法"
        print(f"  {mark} {layer:8} {detail}")
        if not same:
            for val, cnt in vals.most_common():
                who = [nm for nm, v in layers if v[layer] == val]
                shown = str(val)
                print(f"      {cnt} 票 {who}: {shown[:110]}")

    if args.baseline:
        bb = load(args.baseline, args.module)
        if bb is None:
            print(f"  ⚠️ 讀不到 baseline：{args.baseline}")
        else:
            bi = items_of(bb)
            print(f"\n  ── 與既有那份比（{args.baseline.name}）──")
            print(f"     既有 {len(bi)} 題 · 本次 {[v['題數'] for _, v in layers]}")
            base_def = tuple(str(i.get("definition") or "").strip() for i in sorted(
                (x for x in bi if isinstance(x, dict)), key=lambda x: x.get("index") or 0))
            for nm, v in layers:
                same_def = v["解釋逐字"] == base_def
                print(f"     {nm}: 解釋{'完全相同' if same_def else '有差異'}")
            print("     ⚠️ 與既有不同**不代表新的錯** —— 之前查過一次，"
                  "差異來源是既有資料吃掉了數字前後的空格。")

    print()
    if worst == 0:
        print(f"✅ {n} 份輸出的**教學內容**每一層都完全一致")
        print("   （自由註記是否一致見上，那一層不影響學生看到的東西）")
    else:
        print(f"🔴 有層級不一致 —— ⑥a 會飄。")
        print("   ⛔ 這不代表哪一份是錯的，代表**同樣的輸入拿不到同樣的輸出**，")
        print("      所以任何『抽過一次就好』的假設都不成立。")
    return worst


if __name__ == "__main__":
    sys.exit(main())
