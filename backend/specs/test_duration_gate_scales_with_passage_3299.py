"""朗讀的時長門檻要跟著段落長度走，不是一條平的線（#3299）。

為什麼
------
真正的失敗形狀是「130 字的段落只錄到 2 秒」—— 那筆錄音遠超過 1 秒的平門檻，
所以永遠放行，學生等 10–20 秒才拿到「請重錄一次」。

⛔ 而平門檻也**不能直接調大**：最短的重點段只有 17 個可計分字，用產品自己的常模
   （G5 = 200 字/分）唸到及格速度就是 5.1 秒 —— prod 觀察到的那筆 4 515 ms
   落在那一段的合法範圍內。門檻高到擋得住 4.5 秒，就會砍掉真的在唸的孩子。

`_MAX_PLAUSIBLE_CPM = 600` 的依據是實測，不是猜的：staging 人聲語料 338 筆裡
**把全文唸完的 96 筆**，最快 463 字/分（p95 318、中位 258）→ 600 這條線誤砍 0 筆。
（另 94 筆是刻意唸錯版，多半沒唸完，拿全文字數當分母會灌水到 1 030，不可混入。）
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.routes.learning.learning_reading import (
    _MAX_PLAUSIBLE_CPM,
    _MIN_AUDIO_DURATION_MS,
    _min_duration_ms_for,
)

REPO = Path(__file__).resolve().parents[2]


def test_the_pieces_are_there() -> None:
    """對照組：常數被改名或刪掉時，底下每一條都會變成空斷言。"""
    assert _MIN_AUDIO_DURATION_MS > 0
    assert _MAX_PLAUSIBLE_CPM > 0


def test_longer_passage_needs_longer_recording() -> None:
    """核心：門檻必須隨字數單調上升 —— 這正是平門檻做不到的事。"""
    seq = [_min_duration_ms_for(n) for n in (0, 17, 50, 130, 362, 1000)]
    assert seq == sorted(seq), seq
    assert seq[-1] > seq[1], "最長的段落跟最短的段落門檻一樣 = 這條門檻還是平的"


def test_a_median_passage_recorded_for_two_seconds_is_rejected() -> None:
    """票上那個真實形狀：130 字的段落只錄到 2 秒。平門檻放行，這條要擋下。"""
    assert 2000 < _min_duration_ms_for(130), "130 字只錄 2 秒竟然放行 —— 門檻沒作用"
    assert 2000 >= _MIN_AUDIO_DURATION_MS, "前提變了：平門檻已經高過 2 秒，這條要重寫"


# ⚠️ 這裡原本 parametrize (17, 20, 24) 三個長度，說那是「最短的重點段」。
#    那三個數字來自 `backend/data/key_reading_passages.yml` —— **那不是服務來源**。
#    服務走 `build_all_lessons()` → `data/lessons/<uid>/v3/`，真實長度見下。
#    測一個不存在的長度，等於這條負向對照什麼都沒守。
_REAL_LENGTHS = [
    (83, 220, "文-L8 文言文全文：全部 329 段 target 裡最短的"),
    (248, 200, "L0168 重點段：154 個服務中的重點段裡最短的"),
    (566, 190, "L0129 重點段：最長的"),
    (2794, 220, "G9-L23 全文：最長的 target"),
]


@pytest.mark.parametrize("chars,grade_cpm,label", _REAL_LENGTHS)
def test_a_child_reading_at_grade_speed_is_never_rejected(
    chars: int, grade_cpm: int, label: str
) -> None:
    """負向對照：用產品自己的年級常模唸真實長度的課文，不可以被擋。"""
    at_norm_ms = chars / grade_cpm * 60_000
    assert _min_duration_ms_for(chars) <= at_norm_ms, (
        f"{label}：唸到 {grade_cpm} 字/分（及格速度）要 {at_norm_ms:.0f}ms，"
        f"門檻卻是 {_min_duration_ms_for(chars)}ms → 及格的孩子會被擋"
    )


def test_the_ceiling_is_pinned_from_both_sides() -> None:
    """把 `_MAX_PLAUSIBLE_CPM` 夾住 —— 複審實測 600→1000→3000→3800 全綠。

    上界：實測最快的真人完整朗讀是 346 字/分（全語料重算），門檻不可以砍到他。
    下界：門檻要真的擋得住東西 —— 1000 字/分已經是實測最快的 2.9 倍，
          放寬到那裡 gate 形同虛設。
    """
    assert _MAX_PLAUSIBLE_CPM > 463, "門檻低於實測最快的真人（取兩次計算的較高者）→ 會誤砍"
    assert _MAX_PLAUSIBLE_CPM <= 800, (
        f"_MAX_PLAUSIBLE_CPM={_MAX_PLAUSIBLE_CPM} 已是實測最快（463）的 "
        f"{_MAX_PLAUSIBLE_CPM/463:.1f} 倍 —— 這條 gate 等於沒有"
    )


def test_the_gate_counts_in_the_scorers_unit_not_raw_length() -> None:
    """門檻的字數必須用 `gate_char_count`，不可以用 `len()`。

    複審實測：把 `gate_char_count` 換成 `len` 時全部測試照樣綠 —— 而單位正是
    這個設計的全部重點。`len` 會把標點、注音、斷詞用的 `.` 全部算成要唸的字。
    """
    from app.services.reading_transcription_service import gate_char_count

    noisy = "晉平公.問於祁黃羊曰.（如慢跑、游泳）ㄅㄆㄇ"
    assert gate_char_count(noisy) < len(noisy), "gate 的計數跟 len 沒有差別 = 沒在正規化"
    assert _min_duration_ms_for(gate_char_count(noisy)) < _min_duration_ms_for(len(noisy))


def test_gate_char_count_never_exceeds_the_frontend_scorer() -> None:
    """跨語言的單位一致性，對**全部**服務中的課文逐一驗（#3299 複審 H1）。

    多算一個字就多要求 100ms。gate 高於前端 = 門檻比計分器以為的嚴 = 砍到孩子。
    fixture 由 `scripts/build_gate_char_count_fixture.py` 產生（會實際跑前端的
    `countScorableCharacters`），這裡只比對，不重跑 node。
    """
    import csv

    path = REPO / "backend" / "specs" / "fixtures" / "gate_char_count.csv"
    assert path.is_file(), f"少了 {path}"
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    assert len(rows) >= 300, f"只有 {len(rows)} 段，覆蓋不足"
    over = [r for r in rows if int(r["gate_chars"]) > int(r["frontend_scorable_chars"])]
    assert not over, "gate 字數高於前端計分字數（門檻會比計分器嚴）：\n  " + "\n  ".join(
        f"{r['label']}: gate={r['gate_chars']} > fe={r['frontend_scorable_chars']}" for r in over[:10]
    )


def test_the_fastest_real_human_reading_still_passes() -> None:
    """實測錨點：語料裡最快的完整朗讀是 463 字/分，不可以被擋。

    這條是把「600 是量出來的不是拍的」寫死。有人把 _MAX_PLAUSIBLE_CPM 調到 463
    以下，它就紅。
    """
    fastest_observed_cpm = 463  # 兩次計算的較高者（我的子集 463 / 複審全語料 346）—— 取高的才保守
    for chars in (17, 130, 362, 1000):
        dur_ms = chars / fastest_observed_cpm * 60_000
        assert _min_duration_ms_for(chars) <= max(dur_ms, _MIN_AUDIO_DURATION_MS), (
            f"{chars} 字：實測最快的真人（{fastest_observed_cpm} 字/分）要 {dur_ms:.0f}ms，"
            f"門檻 {_min_duration_ms_for(chars)}ms 會把他擋掉"
        )


def test_unknown_passage_falls_back_to_the_flat_floor() -> None:
    """拿不到課文時退回平門檻。

    ⚠️ 這條**不是**在證明有一個保護分支 —— `max(1000, ...)` 本來就會這樣，
       刪掉任何 early return 它都綠。留著是記錄「0 字不會變成 0 毫秒」這個性質，
       不要把它當成守衛的證據（複審實測過那是空斷言）。
    """
    assert _min_duration_ms_for(0) == _MIN_AUDIO_DURATION_MS
    assert _min_duration_ms_for(-5) == _MIN_AUDIO_DURATION_MS


def test_the_flat_floor_is_still_the_lower_bound() -> None:
    """極短段落不可以把門檻壓到比平門檻還低（1 個字 ≠ 100 毫秒就算數）。"""
    assert _min_duration_ms_for(1) == _MIN_AUDIO_DURATION_MS


# ─────────────────────────────────────────────────────────────────────
# 上面驗的是 helper。門檻真正生效的地方是 **route**，而那一層原本一條測試都沒有
# —— 2026-09-17 我就栽在這個形狀：1,083 條 service 測試全綠，route 自己重組回應
# 那幾行沒有任何東西在看，staging 一上線 500。
# ─────────────────────────────────────────────────────────────────────

def _client():
    from unittest.mock import MagicMock

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.auth.dependencies import get_current_user
    from app.auth.rate_limiter import ai_limit_10_per_min
    from app.routes.learning.learning_reading import router

    app = FastAPI()
    user = MagicMock()
    user.id = 42
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[ai_limit_10_per_min] = lambda: None
    app.include_router(router, prefix="/api")
    return TestClient(app)


_LONG = "在很久以前的那個夏天，孩子們沿著溪邊一路走到山腳下，" * 8   # ~200+ 可計分字
_SHORT = "接下來發生的事，就是千古流傳的傳奇了。"                    # 17 可計分字


def test_route_rejects_a_long_passage_recorded_for_two_seconds() -> None:
    """真 route：長段落只錄 2 秒 → 擋下並回 too_short（平門檻放行，這是本票的病）。"""
    r = _client().post(
        "/api/reading/transcribe",
        files={"audio": ("rec.webm", b"x" * 4096, "audio/webm")},
        data={"target_text": _LONG, "duration_ms": "2000"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reason"] == "too_short", body
    assert body["transcript"] is None


def test_route_lets_the_same_two_seconds_through_for_a_short_passage() -> None:
    """正向對照：同樣 2 秒、換成 17 字的段落 → **不可以**被這道門擋。

    少了這條，把門檻設成無限大也會讓上一條綠 —— 那會砍掉所有人。
    （這裡只斷言「不是被時長門擋掉的」；後面 Gemini 那段在測試環境不會成功，
      所以不斷言 transcript。）
    """
    r = _client().post(
        "/api/reading/transcribe",
        files={"audio": ("rec.webm", b"x" * 4096, "audio/webm")},
        data={"target_text": _SHORT, "duration_ms": "2000"},
    )
    assert r.status_code == 200, r.text
    assert r.json().get("reason") != "too_short", r.json()


def test_a_request_without_duration_ms_is_not_a_500() -> None:
    """不帶 `duration_ms` 要正常走完，不可以炸。

    複審實測：拿掉 `duration_ms is not None and` 這個 guard，整套測試照樣全綠，
    而真實行為是 **500**（`'<' not supported between NoneType and int`）——
    整個 repo 沒有任何一條測試打過「不帶 duration_ms」的 transcribe。
    沒送 ≠ 錄音很短，這條路徑必須放行讓後面的流程自己判斷。
    """
    r = _client().post(
        "/api/reading/transcribe",
        files={"audio": ("rec.webm", b"x" * 4096, "audio/webm")},
        data={"target_text": _LONG},  # 刻意不帶 duration_ms
    )
    assert r.status_code == 200, r.text
    assert r.json().get("reason") != "too_short", r.json()


def test_an_oversized_target_is_a_413_not_a_too_short() -> None:
    """超長 target 要回 413，不可以回「錄音太短」（#3299 複審 M3）。

    門檻原本排在 `_MAX_TARGET_CHARS` 檢查之前，於是 5000 字的 target_text
    會拿到 `too_short` —— 前端把它對到「請把整段唸完再按完成」，
    也就是把一個 client 端的 bug 變成叫孩子多唸一點。
    """
    r = _client().post(
        "/api/reading/transcribe",
        files={"audio": ("rec.webm", b"x" * 4096, "audio/webm")},
        data={"target_text": "字" * 5000, "duration_ms": "60000"},
    )
    assert r.status_code == 413, f"回了 {r.status_code}：{r.text[:200]}"


def test_the_route_itself_counts_in_the_scorers_unit() -> None:
    """route 的呼叫處也要用 `gate_char_count`，不可以是 `len`（複審 ③）。

    我原本只驗了 service 的 `gate_char_count`，所以把 **route 那一行**換成 `len`
    整套照樣綠 —— 又是「helper 對但接錯」的形狀。

    造一段 gate 與 len 差很多的文字（滿是斷詞點與注音），挑一個落在兩個門檻之間的
    時長：用 gate 算應該放行，用 len 算會被擋。
    """
    from app.services.reading_transcription_service import gate_char_count

    noisy = "晉平公.問於祁黃羊曰.南陽無令.其誰可而為之.ㄅㄆㄇㄈㄉㄊㄋㄌ" * 6
    g, raw = gate_char_count(noisy), len(noisy)
    assert raw > g * 1.4, f"這段文字分不開兩種算法（gate={g} len={raw}），換一段"
    between = (_min_duration_ms_for(g) + _min_duration_ms_for(raw)) // 2
    r = _client().post(
        "/api/reading/transcribe",
        files={"audio": ("rec.webm", b"x" * 4096, "audio/webm")},
        data={"target_text": noisy, "duration_ms": str(between)},
    )
    assert r.status_code == 200, r.text
    assert r.json().get("reason") != "too_short", (
        f"gate 要求 {_min_duration_ms_for(g)}ms、len 要求 {_min_duration_ms_for(raw)}ms，"
        f"錄了 {between}ms 卻被擋 → route 用的是 len 不是 gate_char_count"
    )


def test_the_fixture_still_matches_what_gate_char_count_produces_today() -> None:
    """fixture 的 gate 欄要能被現在的 code 重算出來（複審：靜態 fixture 沒牙）。

    前端那一欄是凍結的（重算要跑 node，太慢不適合放進 spec），但 gate 這一欄
    每次重算 —— 所以把剝除規則改弱（例如不再剝注音）會在這裡紅，
    而不是等到某個孩子被多要求幾百毫秒才發現。
    """
    import csv
    import glob

    import yaml

    from app.services.reading_transcription_service import gate_char_count

    texts: dict[str, str] = {}
    for path in glob.glob(str(REPO / "backend/data/lessons/*/v3/key_reading.*.yml")):
        uid = Path(path).parts[-3]
        y = yaml.safe_load(Path(path).read_text("utf-8")) or {}
        if (y.get("key_reading") or {}).get("passage"):
            texts[f"{uid}/{Path(path).name}"] = y["key_reading"]["passage"]
    for path in glob.glob(str(REPO / "backend/data/lessons/*/v3/full_text_annotate.*.yml")):
        uid = Path(path).parts[-3]
        y = yaml.safe_load(Path(path).read_text("utf-8")) or {}
        paras = [
            str(b["text"])
            for b in ((y.get("full_text_annotate") or {}).get("paragraphs") or [])
            if isinstance(b, dict) and b.get("text")
        ]
        if paras:
            texts[f"{uid}/{Path(path).name}"] = "".join(paras)

    rows = list(csv.DictReader((REPO / "backend/specs/fixtures/gate_char_count.csv").open(encoding="utf-8")))
    drift = [
        (r["label"], int(r["gate_chars"]), gate_char_count(texts[r["label"]]))
        for r in rows
        if r["label"] in texts and gate_char_count(texts[r["label"]]) != int(r["gate_chars"])
    ]
    assert not drift, (
        "gate_char_count 的結果跟 fixture 對不上（剝除規則或課文動過）：\n  "
        + "\n  ".join(f"{l}: fixture={a} 現在={b}" for l, a, b in drift[:10])
        + "\n→ 重跑 `python3 scripts/build_gate_char_count_fixture.py`（它會同時重算前端那一欄）"
    )
    assert len(rows) - len(drift) >= 300, "比對到的段落太少，這條鎖幾乎沒在守東西"
