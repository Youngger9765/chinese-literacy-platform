"""全語料的跨畫面基準 —— 取代只看 31 句的那條門。(#3215)

## 為什麼既有那條不夠

`test_zhuyin_cross_surface_drift_3202.py` 的語料是前端測試檔裡的 31 句。
它現在停在 2 筆，讀起來像「快好了」——**它綠是因為它的世界只有 31 句**：

    31 條斷言實際守住的字      7 個
    全語料會不一致的字        74 個
      完全沒有測試提到的      68 個
      落在無人看守的字上      1,322 / 3,934 = 33.6%

跟 #3177 完全同型（44 條全綠而 行／著 的兩個常用讀音在正式站是反的）：
**綠著的 golden set 鎖住的是一個太小的世界。**

## 這一支守三件事

| | 抓什麼 |
|---|---|
| `triples` | 兩個畫面的差異本身：新增紅、次數變動紅、消失也紅（進步要留紀錄）|
| `fingerprints` | 每課後端輸出的 hash —— **連「兩邊一起漂」都抓得到**（poyin_db 改一筆或 pypinyin 升版，兩個畫面會一起動，其他測試全綠）|
| `_provenance.sources` | 四樣來源的 sha256。⛔ 少了它凍結的清單會**靜靜過期**，而那正是這整件事在修的病 |

## 課文頁那一半不是重算的

`triples` 裡的課文頁讀音來自**出貨的前端 TS**（esbuild 打包後在 node 直接跑，見
`scripts/generate_cross_surface_baseline.py` 檔頭）。這支測試**不跑 node**，
它比對的是 committed 的基準；來源有沒有變由那四個 sha256 負責。

⚠️ **課文頁不是真值。** 抽 18 個爭議案例送教育部辭典判：課文頁對 12、後端對 6
（`相反`／`姊姊`／`貼切`／`命中`／`暑假`／`天分` 是後端對的）。
所以這支測的是**漂移**不是**對錯** —— 把 `triples` 清空不代表變正確。
"""

from __future__ import annotations

import json
import pathlib
import sys

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
BASELINE = BACKEND / "data" / "zhuyin" / "cross_surface_baseline.json"

sys.path.insert(0, str(BACKEND / "scripts"))


@pytest.fixture(scope="module")
def baseline() -> dict:
    assert BASELINE.exists(), f"基準檔不在 {BASELINE}"
    return json.loads(BASELINE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def gen():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "gcsb", BACKEND / "scripts" / "generate_cross_surface_baseline.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_baseline_is_not_empty(baseline: dict) -> None:
    """前提：基準真的有東西。

    少了這條，載入器一壞就變成「比零筆」而全綠 —— 跟「完全一致」長得一模一樣。
    """
    assert baseline["passages"] > 1_500, f"只有 {baseline['passages']} 段"
    assert baseline["comparable"] > 60_000, f"可比位置只有 {baseline['comparable']}"
    assert len(baseline["fingerprints"]) > 150, "每課指紋數不對"


def test_the_frozen_sources_have_not_changed(gen, baseline: dict) -> None:
    """四樣來源的 sha256。任一改變 → 凍結的基準已過期，要重跑產生器。

    ⛔ 最容易忘的是 `components/zhuyin/*.ts`（`toneSandhi`／`polyphonicPatternMatcher`
    那些）。改了它們而不重生，這份基準就開始說謊，而且沒有別的東西會發現。
    """
    have = baseline["_provenance"]["sources"]
    now = gen.source_fingerprints()
    assert set(have) == set(now), f"守的來源清單變了：{sorted(set(have) ^ set(now))}"
    drifted = sorted(k for k in now if have[k] != now[k])
    assert not drifted, (
        "這些來源變了，`cross_surface_baseline.json` 已過期 —— 請重跑\n  "
        "`python3 backend/scripts/generate_cross_surface_baseline.py --fe <oracle 輸出>`\n"
        "（oracle 的產生方式見該檔檔頭）：\n  " + "\n  ".join(drifted)
    )


def test_backend_output_has_not_drifted(gen, baseline: dict) -> None:
    """每課的後端輸出指紋 —— 這條抓得到「兩個畫面一起漂」。

    其他所有測試都在比「後端 vs 課文頁」，所以兩邊同時變會全綠。
    這條只看後端自己，凍結在一個已知狀態。
    """
    texts = gen.corpus()
    assert len(texts) == baseline["passages"], (
        f"語料從 {baseline['passages']} 段變成 {len(texts)} 段 —— 課程資料動過了，"
        "基準要重生"
    )
    maps = gen.backend_readings(texts)

    import collections
    import hashlib

    per_lesson: dict[str, list[str]] = collections.defaultdict(list)
    for item, m in zip(texts, maps):
        per_lesson[item["lesson"]].append("|".join(f"{i}:{m[i]}" for i in sorted(m)))
    now = {
        lesson: hashlib.sha256("\n".join(rows).encode()).hexdigest()[:16]
        for lesson, rows in sorted(per_lesson.items())
    }

    frozen = baseline["fingerprints"]
    changed = sorted(k for k in now if frozen.get(k) != now[k])
    assert not changed, (
        f"{len(changed)}/{len(now)} 課的後端注音輸出變了。若是刻意的改動，"
        "重跑產生器並在 PR 裡說明變的是什麼：\n  " + ", ".join(changed[:12])
    )


def test_the_baseline_records_a_known_bad_state_not_a_perfect_one(baseline: dict) -> None:
    """基準必須記著「今天有 3,934 個不一致」，不可以是一份宣稱完美的檔。

    ⚠️ **這條是補上來的，而它缺席的那段時間正是最危險的形狀。**
    上面的 docstring 從第一版就寫著「triples：新增紅、次數變動紅」，
    而實際上**沒有任何一條斷言讀 `triples`** —— 對抗式複審把基準換成
    「宣稱 63,115 個位置全部一致」的假版本，整支照樣 40 passed。
    紀錄存在、宣告存在、驗證不存在 —— 跟 #3177 同型。

    ## 為什麼不是「重算不一致數」那種寫法

    要重算「不一致」需要**前端每個位置的讀音**，那是 1.32 MB 的產物，
    而我們刻意不 commit 它（10 KB vs 1.3 MB）。我第一版試著用
    「(字, 後端讀音) 的出現次數」反推，那會把**一致**的位置一起算進去 —— 錯的。

    所以這裡改守兩件真的檢查得了的事：

      1. 基準內部自洽（`agree + Σ次數 == comparable`）
      2. 基準記錄的是**已知的壞狀態**（今天 3,934 個不一致、83 組）。
         一份宣稱零不一致的基準在今天必然是假的

    「不一致有沒有變多」由另外兩條聯合保證：前端那側由四個 sha256 釘住
    （來源沒變 → 輸出不可能變），後端那側由每課指紋釘住。兩邊都不動，
    差異集合就不可能動。而**重跑產生器時會不會靜靜吞掉新增的不一致**，
    由產生器自己擋（見 `generate_cross_surface_baseline.py` 的成長檢查）。
    """
    comparable, agree = baseline["comparable"], baseline["agree"]
    triples = baseline["triples"]
    total_disagree = sum(n for *_, n in triples)

    assert agree + total_disagree == comparable, (
        f"基準內部不自洽：一致 {agree} + 不一致 {total_disagree} != 可比 {comparable}"
    )
    assert total_disagree > 3_000, (
        f"基準說只有 {total_disagree} 個不一致 —— 今天實測是 3,934。"
        "一份宣稱接近完美的基準在現階段必然是假的，不要拿它當綠燈"
    )
    assert len(triples) > 50, f"只有 {len(triples)} 組相異三元組，實測是 83"
