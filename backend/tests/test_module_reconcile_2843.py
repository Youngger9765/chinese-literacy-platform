"""對帳門：宣告的大題 ⟷ 產出的模組檔（#2843）。

## 這道門回答「出錯時該找誰的麻煩」

Young 2026-08-21 會議上講的核心痛點：

> 「他現在的機制到底是一個怎麼回事？我們要非常清楚。
>   如果 key reading 沒有抽成功，那我們應該去找 key reading skill 的麻煩才對。」

在此之前沒有任何東西把「學習單有哪幾個大題」跟「產出了哪些模組檔」對起來，
所以出錯時只能一路猜。這道門就是那個對照。

## 三種紅法各自指名責任方

| 情況 | 該找誰 |
|---|---|
| 宣告有、檔案沒有（且不在已知缺口裡） | 該模組的抽取 |
| 檔案有、宣告沒有 | `sections_present` 的產生端漏看了 |
| 大題名對不到任何模組，也不在 unresolved | `section-to-module.yml` 缺一條 |

## 為什麼有基準檔而不是 == 0

現況有 11 筆「檔案有、宣告沒有」。寫 `== 0` 的話門一上線就恆紅，
**紅久了就沒人看** —— 真的有新的漏看冒出來也不會有人發現。

棘輪只保證不再變差。要縮小就一筆一筆開原稿確認，解掉一筆更新一次基準。
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BASELINE = REPO_ROOT / "qa" / "reconcile" / "baseline.json"
sys.path.insert(0, str(REPO_ROOT / "scripts"))


@pytest.fixture(scope="module")
def result():
    from module_reconcile_gate import reconcile  # noqa: PLC0415
    return reconcile()


@pytest.fixture(scope="module")
def baseline():
    assert BASELINE.is_file(), f"基準檔不存在：{BASELINE}"
    return json.loads(BASELINE.read_text(encoding="utf-8"))


def test_the_gate_actually_scanned_lessons(result):
    """掃描前提 —— 少了這條，掃不到課時下面每一條都會恆綠。"""
    assert result["scanned"] >= 150, f"只對帳了 {result['scanned']} 課，掃描壞了"


def test_no_module_declared_but_missing(result):
    """🔴 宣告有、檔案沒有 —— 那個模組沒抽出來，而且不在已知缺口裡。

    已知缺口（`content_known_gaps.yaml` 的 46 課 / 167 筆）已被排除，
    所以這裡任何一筆都是新問題。
    """
    assert not result["missing_file"], (
        "以下模組被學習單宣告了，卻沒有對應的檔案，也不在已知缺口裡：\n"
        + "\n".join(f"  {m}: {', '.join(u)}" for m, u in sorted(result["missing_file"].items()))
        + "\n\n→ 那個模組的抽取沒成功。先確認學習單真的有印那一節。"
    )


def test_unannounced_modules_do_not_grow(result, baseline):
    """檔案有、宣告沒有 —— 棘輪：只准降不准升。

    ⛔ 不寫 `== 0`：現況有 11 筆，恆紅的門沒人看。
    """
    actual = {m: sorted(u) for m, u in result["unannounced"].items()}
    expected = baseline["unannounced"]
    grew = {
        m: sorted(set(u) - set(expected.get(m, [])))
        for m, u in actual.items()
        if set(u) - set(expected.get(m, []))
    }
    assert not grew, (
        "以下模組新出現「檔案有、宣告沒有」—— 總覽漏看了一個大題：\n"
        + "\n".join(f"  {m}: {', '.join(u)}" for m, u in sorted(grew.items()))
        + "\n\n→ 開該課原稿確認：學習單真的沒印那一節（那 sections_present 是對的），"
          "\n  還是總覽漏看了（那要補進 sections_present）。"
    )


def test_every_section_name_maps_or_is_declared_unresolved(result):
    """🔴 大題名對不到模組、也不在 unresolved 名單裡 → 對照表缺一條。

    這條沒有基準 —— 新的大題名一定要有人看一眼，不可以靜默累積。
    """
    assert not result["unknown_section"], (
        "以下大題名對不到任何模組，也不在 unresolved 名單裡：\n"
        + "\n".join(f"  {c} 課  {n}" for n, c in sorted(result["unknown_section"].items(), key=lambda kv: -kv[1]))
        + "\n\n→ 開該課的原稿與 yml 對一次，加進 specs/modules/section-to-module.yml 的"
          "\n  matches（能歸因）或 unresolved（歸不了因，但要看得見）。"
          "\n⛔ 不要憑名字像就加進 matches —— 猜錯會讓對帳門把好課判成壞課。"
    )


def test_unresolved_list_does_not_grow(result, baseline):
    """未解的大題名也是棘輪 —— 可以有欠債，但不准愈欠愈多。"""
    actual_total = sum(result["unresolved"].values())
    expected_total = sum(baseline["unresolved_sections"].values())
    assert actual_total <= expected_total, (
        f"未解的大題名從 {expected_total} 筆變成 {actual_total} 筆。\n"
        f"現況：{result['unresolved']}\n"
        "→ 新的大題名要嘛歸因進 matches，要嘛在 PR 說明為什麼歸不了因。"
    )
