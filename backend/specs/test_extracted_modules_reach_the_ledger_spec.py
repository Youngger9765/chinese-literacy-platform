"""抽好的模組檔一定要出現在派工單裡（#3011）。

## 這道門守的是什麼

`_manifest.yml` 是分派的實體契約 —— 消費端（QR、朗讀、對帳）都問它
「這一課有哪幾個大題、各自的代號是什麼」。代號只住在帳本裡。

所以一份**在硬碟上、內容也對、API 也服務得出來**的模組檔，只要沒被
帳本列到，對每一個消費端就是不存在的。而它不會報錯：清單照樣產出、
`--check` 照樣印綠、頁面照樣打得開。

## 為什麼會發生（真實案例，不是假想）

`build_lesson_manifest.py::build_one` 開頭有一句：

    rows = lesson.get("sections_present") or []
    if not rows:
        return None            # ← 這裡

`sections_present` 是學習單自己印的大題目錄，174/175 課有。少的那一課是
**G8-L4（L0124）** —— 它的目錄抽取失敗留下空清單，於是整課被跳過、
連一份帳本都沒產出。而主迴圈對 `None` 是 `continue`，所以 `--check`
在比對之前就跳過它，永遠回「✅ 所有 _manifest.yml 都跟來源一致」。

結果：那一課 9 個抽好的模組檔對派工單完全隱形，念順順的代號拿不到，
段落 QR 靜靜地不出。2026-08-31 明珠老師回報「G8-L4 沒有段落 QRcode」。

## 判準

棘輪，不是寫死當天的數字：**沒有帳本 / 帳本漏列的課只能變少**。
情況變好的時候這道門不可以紅。
"""
from __future__ import annotations

import pathlib

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO / "backend" / "data" / "lessons"
MAP_FILE = REPO / "specs" / "modules" / "section-to-module.yml"

#: 這些 stem 不是「大題」，帳本本來就不會列（跟 builder 讀同一份表，不另抄一份）。
_TABLE = yaml.safe_load(MAP_FILE.read_text(encoding="utf-8")) or {}
NOT_SECTIONS = set(_TABLE.get("not_sections", []))

#: 帳本漏列了硬碟上某個模組的課。⛔ 只能變少（棘輪）。
#:
#: 這些課的共同形狀是：**帳本同時是兩件事，而它們在這裡分岔了** ——
#: 它既是「學習單印的大題目錄」，也是「代號目錄」（slug 只住這裡）。
#: 例如 L0044/L0068/L0070/L0106 的學習單沒有「讀全文」這個大題，可是
#: `full_text_annotate.<slug>.yml` 在硬碟上、課文也真的服務得出來（577–1650 字）。
#: 目錄不列它 → 拿不到代號 → 那四課的全文 QR 一直是空的。
#:
#: ⚠️ #3011 一度把它們補進帳本尾端（標 `printed: false`）。那會讓
#: `full_text_annotate` 流進 `step_sequence`，於是學生多出一個
#: **他的學習單根本沒有**的「讀全文」步驟 ——
#: `test_step_sequence_from_worksheet_2736` 當場抓到。所以撤回了。
#:
#: 正解是讓代號目錄與大題目錄分開表達（帳本補一個不進 step_sequence 的欄位，
#: 或 `_section_slugs_by_article` 另有來源），那是比這張票大的改動。
#: 在那之前先把債記在這裡數住：**只能變少，不准長大**。
KNOWN: set[str] = {
    "L0044",  # G5-L5  學習單沒印「讀全文」，但課文 9 段在硬碟上
    "L0068",  # G6-L29 同上，13 段
    "L0070",  # G6-L3  同上，9 段
    "L0091",  # G7-L22 帳本漏列 writing_practice
    "L0106",  # G7-L9  同上，8 段
    "L0136",  # G9-L15 帳本漏列 spotlight
    "L0154",  # 文-L11 帳本漏列 key_reading（passage 是 0 字，沒東西可唸）
    "L0155",  # 文-L12 同上
}


def _on_disk(vdir: pathlib.Path) -> set[str]:
    """這一課硬碟上真的有哪些大題模組檔。"""
    out = set()
    for f in vdir.glob("*.*.yml"):
        mod = f.stem.partition(".")[0]
        if mod and not mod.startswith("_") and mod not in NOT_SECTIONS:
            out.add(mod)
    return out


def _in_ledger(vdir: pathlib.Path) -> set[str] | None:
    """派工單列了哪些模組；帳本不存在回 None（跟「列了 0 個」要分得開）。"""
    man = vdir / "_manifest.yml"
    if not man.is_file():
        return None
    doc = yaml.safe_load(man.read_text(encoding="utf-8")) or {}
    return {s.get("module") for s in (doc.get("sections") or []) if s.get("module")}


def _offenders() -> dict[str, str]:
    bad: dict[str, str] = {}
    for vdir in sorted(LESSONS.glob("L*/v3")):
        uid = vdir.parent.name
        disk = _on_disk(vdir)
        if not disk:
            continue
        led = _in_ledger(vdir)
        if led is None:
            bad[uid] = f"沒有 _manifest.yml，但硬碟上有 {len(disk)} 個模組檔"
        elif missing := (disk - led):
            bad[uid] = f"帳本漏列 {sorted(missing)}"
    return bad


def test_positive_control_the_scan_can_see_a_lesson_at_all():
    """先證明這個掃描抓得到東西 —— 否則下面的「沒有違規」什麼都不證明。"""
    scanned = [v for v in LESSONS.glob("L*/v3") if _on_disk(v)]
    assert len(scanned) >= 150, f"只掃到 {len(scanned)} 課，掃描本身壞了"
    # 而且至少有一課的帳本真的列得出模組（不是全部回空集合）
    assert any((_in_ledger(v) or set()) for v in scanned), "沒有任何一課的帳本列得出模組 —— 讀法壞了"


def test_every_extracted_module_is_dispatched():
    bad = _offenders()
    extra = set(bad) - KNOWN
    assert not extra, (
        "這些課的模組檔抽好了但派工單看不到它們（代號拿不到 → QR 不出）：\n"
        + "\n".join(f"  {uid}: {bad[uid]}" for uid in sorted(extra))
        + "\n\n跑 `python scripts/build_lesson_manifest.py` 重產帳本。"
    )


def test_known_list_only_shrinks():
    """棘輪：修好的課要從 KNOWN 移走，不可以留著當免死金牌。"""
    assert not (KNOWN - set(_offenders())), (
        f"KNOWN 裡有已經修好的課，請移除：{sorted(KNOWN - set(_offenders()))}"
    )
