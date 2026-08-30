"""學生真的拿得到完整的念順順範圍 —— 在**服務端**驗，不是驗檔案。(#2912)

## 為什麼要另外一支

已經有的鎖都在驗**檔案**（yml 的 start/end/passage、抽取器一致性）。
但這個 repo 反覆發生的病是「**抽對了卻沒人接**」：資料是對的，
`.get()` 回 None、合併那一步是 no-op、schema 把欄位擋掉 —— 學生看到的還是空的或短的。

`test_key_reading_passages_2562.py` 已經打真端點，但**只驗 G4-L1 一課**。
一課驗不出「整批沒接上」。2026-08-30 那次 regression 的樣態就是**全庫一起**變 ——
所以服務端也要有廣度。

⛔ 這支不重複驗內容對不對（那是 golden set 的事），只驗
   「**檔案裡有的，學生拿得到**」與「**拿到的量夠測流暢度**」。
"""

from __future__ import annotations

import pathlib
import statistics

import pytest
import yaml
from fastapi.testclient import TestClient

from app.main import app

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"

#: 明珠老師 2026-08-29：測段落閱讀流暢度需要至少 300 字。
_FLUENCY_MIN = 300

client = TestClient(app)


def _shipped_with_passage() -> dict[str, int]:
    """uid -> 檔案裡最長的那篇 passage 長度（一課多篇時取最長）。"""
    out: dict[str, int] = {}
    for f in sorted(list(LESSONS.glob("L*/v3/key_reading.yml"))
                    + list(LESSONS.glob("L*/v3/key_reading.*.yml"))):
        kr = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("key_reading") or {}
        p = kr.get("passage") or ""
        if p:
            out[f.parts[-3]] = max(out.get(f.parts[-3], 0), len(p))
    return out


@pytest.fixture(scope="module")
def served() -> dict[int, dict]:
    r = client.get("/api/stories", params={"page_size": 300})
    assert r.status_code == 200, r.text
    body = r.json()
    total = body.get("total")
    stories = body.get("stories") or []
    # ⛔ `page_size` 的上限是 300，傳更大會被**靜默忽略**只回 60 筆。
    #    不斷言拿全就會拿一小把當全體（這個 repo 犯過）。
    assert len(stories) == total, f"只拿到 {len(stories)}/{total} 課 —— 沒拿全"
    out = {}
    for s in stories:
        d = client.get(f"/api/stories/{s['id']}")
        if d.status_code == 200:
            out[s["id"]] = d.json()
    return out


def test_the_sweep_actually_fetched_lessons(served):
    """正向對照。少了這條，下面每一條都會在空 dict 上通過。"""
    assert len(served) >= 100, f"只取到 {len(served)} 課詳情 —— 掃描壞了，不是課變少了"


def test_most_lessons_serve_a_key_reading(served):
    """廣度：檔案裡有 passage 的課，服務端也要給得出來。

    ⛔ 這條擋的是「合併那一步是 no-op」——資料對、API 回出去卻沒有 key_reading。
       #2559 就是驗錯層（驗 loader 全綠、API 回的沒有）。
    """
    have_file = len(_shipped_with_passage())
    assert have_file >= 100, f"檔案裡只有 {have_file} 課有 passage —— 掃描壞了"
    have_api = sum(1 for j in served.values() if (j.get("key_reading") or {}).get("passage"))
    assert have_api >= 100, (
        f"檔案裡 {have_file} 課有 passage，服務端只給得出 {have_api} 課。"
        "抽對了但學生拿不到 —— 檢查合併那一步是不是 no-op"
    )


def test_the_served_passages_are_long_enough_to_time_fluency(served):
    """量：學生拿到的要夠測流暢度。

    2026-08-30 那次 regression 的樣態是**全庫一起**掉到中位 144 字，
    所以這裡用中位數與 >=300 字的課數，不是單課。
    """
    lens = [len((j.get("key_reading") or {}).get("passage") or "")
            for j in served.values()
            if (j.get("key_reading") or {}).get("passage")]
    assert lens, "服務端一課都沒給出 passage"
    med = statistics.median(lens)
    assert med >= _FLUENCY_MIN, (
        f"服務端 passage 中位數只有 {med:.0f} 字。老師測段落閱讀流暢度需要至少 "
        f"{_FLUENCY_MIN} 字（明珠老師 2026-08-29 回報）。"
        "2026-08-30 那次 regression 是 144 字"
    )
    long_enough = sum(1 for x in lens if x >= _FLUENCY_MIN)
    assert long_enough >= 100, (
        f"服務端只有 {long_enough}/{len(lens)} 課 >= {_FLUENCY_MIN} 字（regression 當時是 4）"
    )


def test_the_api_does_not_truncate_what_the_file_has(served):
    """服務端給的不可以比檔案裡的短 —— 那是截斷，不是規則。

    ⛔ 這條跟上面兩條不同：它比的是**同一課的兩層**。
       量夠、課數也夠，仍然可能每一課都被砍掉尾巴。
    """
    files = _shipped_with_passage()
    by_code: dict[str, int] = {}
    for j in served.values():
        p = (j.get("key_reading") or {}).get("passage") or ""
        if p:
            by_code[str(j.get("id"))] = max(by_code.get(str(j.get("id")), 0), len(p))
    served_max = max(by_code.values()) if by_code else 0
    file_max = max(files.values()) if files else 0
    assert served_max >= file_max * 0.9, (
        f"服務端最長的 passage 只有 {served_max} 字，檔案裡最長的是 {file_max} 字 —— "
        "看起來被截斷了"
    )
