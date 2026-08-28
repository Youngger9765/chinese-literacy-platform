"""每一種模組都要寫出**誰在守它**（#2872）。

## 為什麼

見證對帳門只看得懂「有編號題目」的模組。其餘 17 種它回「不適用」——
而 `⬜ 不適用` 跟 `✅ 通過` 在輸出上長得太像，於是那 17 種**等於沒有人在看**，
而且沒有人會發現。

⛔ 這不是「加更多門」能解的（多數模組本來就沒有題號可以數）。
解法是把「誰在守」寫下來、並鎖住它跟現實對得上：
  · 每一種模組都要登記
  · 登記的那道門要**真的存在**（不能是一句好聽的話）
  · 語料庫新增模組時鎖會叫

## 這條鎖不保證什麼

它保證「每一種模組都有人認領」，⛔ **不保證那道門夠強**。
例：`content_fidelity_attest` 驗「抄的字對不對」，不驗「該有的東西在不在」——
一整個大題被漏抽，逐字門是綠的。那是下一層的問題，不在這條鎖的範圍。
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO / "backend" / "data" / "lessons"


def _wg():
    spec = importlib.util.spec_from_file_location(
        "wg", REPO / "scripts" / "witness_reconcile_gate.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _corpus_modules() -> set[str]:
    """檔名裡的**模組類型**，不含 slug。

    ⚠️ #2916 之後檔名是 `{模組}.{slug}.yml`，`p.stem` 會回 `comprehension.34pme`。
       登記表登記的是**類型**（一種模組一道門），不是每一份檔 ——
       不切掉 slug 的話這條會報「1623 種模組沒登記」，
       而真正的類型數量只有二十幾種。
    """
    out = set()
    for p in LESSONS.glob("L*/v3/*.yml"):
        mod = p.stem.partition(".")[0]
        if mod != "lesson" and not mod.startswith("_"):
            out.add(mod)
    return out


def test_the_scan_returns_types_not_files():
    """正向對照 + 防呆 —— 掃出來的必須是類型，不是一課一個。

    少了這條，slug 又混進來時上面那條會報幾百種「沒登記」，
    而真正的原因是掃描壞了，不是登記漏了。
    """
    mods = _corpus_modules()
    assert 5 <= len(mods) <= 60, f"掃出 {len(mods)} 種模組 —— 這個數字不像類型數"
    dotted = sorted(m for m in mods if "." in m)
    assert not dotted, f"這些還帶著 slug，切割壞了：{dotted[:5]}"


def test_every_module_is_registered():
    """用**數量**斷言 —— 少登記一種不會有任何症狀。"""
    wg = _wg()
    missing = sorted(_corpus_modules() - set(wg.GUARDED_BY))
    assert not missing, f"{len(missing)} 種模組沒登記誰在守：{missing}"


def test_the_registry_has_no_ghosts():
    """反向：登記了但語料庫沒有 = 表過期了。"""
    wg = _wg()
    ghosts = sorted(set(wg.GUARDED_BY) - _corpus_modules())
    assert not ghosts, f"登記表有幽靈項目：{ghosts}"


def test_every_named_guard_actually_exists():
    """⛔ 登記的那道門必須真的存在，不可以是一句好聽的話。

    這是這條鎖唯一有牙齒的地方 —— 沒有它，登記表就只是一份心願清單。
    """
    wg = _wg()
    known = {
        "witness_reconcile_gate": REPO / "scripts" / "witness_reconcile_gate.py",
        "content_fidelity_attest": REPO / "scripts" / "content_fidelity_attest.py",
        "keypoints_shape_gate": REPO / "scripts" / "keypoints_shape_gate.py",
        "spotlight_fingerprints": REPO / "scripts" / "spotlight_fingerprints.py",
        "normalize_word_search": REPO / "scripts" / "normalize_word_search.py",
        "schema": REPO / "specs" / "modules" / "schemas",
    }
    for path in known.values():
        assert path.exists(), f"登記表引用的 {path.name} 不存在 —— 懸空引用"

    for mod, desc in wg.GUARDED_BY.items():
        named = [k for k in known if k in desc]
        assert named, (
            f"{mod} 登記的守門者「{desc}」沒有對應到任何真的腳本 —— "
            "⛔ 登記表不可以寫一句好聽的話"
        )


def test_numbered_modules_are_all_registered_as_such():
    """在題號型門裡的，登記表也要說是它守 —— 兩處不能各說各話。"""
    wg = _wg()
    for mod in sorted(wg.NUMBERED_MODULES):
        assert "witness_reconcile_gate" in wg.GUARDED_BY.get(mod, ""), (
            f"{mod} 在 NUMBERED_MODULES 裡，但登記表說守它的是"
            f"「{wg.GUARDED_BY.get(mod)}」"
        )


def test_resources_stays_out_of_the_numbered_gate():
    """`resources` 有題號但**原稿不印** —— 加進去會誤報。

    實測：L0004 / L0008 原稿只數到 [2]、L0002 一個都數不到，
    而 yml 是 [1, 2]。那不是資料壞，是文字層本來就沒有那些編號。
    ⛔ 判準訂錯比沒有判準更糟 —— 會叫的門最後會被關掉。
    """
    wg = _wg()
    assert "resources" not in wg.NUMBERED_MODULES, \
        "resources 被加進題號型門了 —— 它會對至少 3 課誤報"


def test_self_challenge_is_in_the_numbered_gate():
    """`self_challenge` 2026-08-23 加入：實測 6/6 原稿題號與 yml 全中。"""
    wg = _wg()
    assert "self_challenge" in wg.NUMBERED_MODULES
