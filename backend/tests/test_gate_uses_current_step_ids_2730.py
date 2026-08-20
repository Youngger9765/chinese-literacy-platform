"""content evidence gate 用的 step id 必須是**現在服務的那些**，不是舊名。

門報 350/350 全 fail，而內容是好的。L1 的不變量全部 pass，
掛掉的是 L3 render 的 `loaded: false`。

真瀏覽器實測（2026-08-20，staging，學生小明）：

    請求 /learn/20001/reading-strategy  →  轉址到 /learn/20001/spotlight  頁面正常（1162 字）
    請求 /learn/20001/spotlight         →  /learn/20001/spotlight        頁面正常（1162 字）

門的判準是

    loaded = href.endswith(f"/learn/{story_id}/{step}")

`step` 是舊名 `reading-strategy`，app 轉址到 `spotlight`，
於是 `endswith` 永遠 false ——**每一格都 fail，而每一格其實都好的**。

`frontend/src/config/stepConfig.ts` 的 `LEGACY_STEP_ID_ALIASES` 明講那兩個是舊 id：

    'reading-strategy': 'spotlight',
    'story-structure':  'keypoints-table',

這條鎖的是「門問的路徑跟 app 服務的路徑是同一條」。
⛔ 不要改成「容忍轉址」—— 那會讓門對「step 被改名了」這件事失去感知，
下次改名照樣全紅，而且訊號更難讀。
"""
from __future__ import annotations

import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
GATE = REPO / "scripts" / "content_evidence_gate.py"
STEP_CONFIG = REPO / "frontend" / "src" / "config" / "stepConfig.ts"


def _gate():
    """載入門的模組本身，驗它**真的會請求什麼路徑**，不是驗字面常數。

    內部識別名（`STEPS`）刻意保留舊字串 —— known_gaps 的 key 用它。
    要鎖的是「送出去的網址」跟 app 服務的路徑是同一條。
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location("_gate_under_test", GATE)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(REPO / "scripts"))
    sys.path.insert(0, str(REPO / "backend"))
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.path.pop(0)
        sys.path.pop(0)
    return mod


def _gate_url_ids() -> list[str]:
    g = _gate()
    return [g.step_url_id(s) for s in g.STEPS]


def _legacy_aliases() -> dict[str, str]:
    src = STEP_CONFIG.read_text(encoding="utf-8")
    m = re.search(r"LEGACY_STEP_ID_ALIASES[^{]*\{(.*?)\}", src, re.S)
    assert m, "找不到 LEGACY_STEP_ID_ALIASES —— 這條鎖沒在測東西"
    return dict(re.findall(r"[\"']?([a-z0-9-]+)[\"']?\s*:\s*[\"']([a-z0-9-]+)[\"']", m.group(1)))


def test_the_lock_can_see_both_sides():
    """正向對照：兩邊都讀得到、都不是空的。

    少了這條，正則抓不到時上面兩個 assert 之外的斷言會對空集合恆真。
    """
    steps = _gate_url_ids()
    aliases = _legacy_aliases()
    assert len(steps) >= 2, steps
    assert len(aliases) >= 4, aliases
    assert "reading-strategy" in aliases, "對照表裡本來就該有這個舊名"


def test_the_gate_does_not_ask_for_renamed_steps():
    aliases = _legacy_aliases()
    stale = [s for s in _gate_url_ids() if s in aliases]
    assert stale == [], (
        "門實際請求的路徑用的是已改名的舊 step id：\n"
        + "\n".join(f"  {s} → 現在是 {aliases[s]}" for s in stale)
        + "\n\napp 會把舊名轉址到新名，而門的 loaded 判準是 "
        "`href.endswith(f'/learn/{id}/{step}')` —— 轉址之後永遠對不上，"
        "於是每一格都 fail，而內容其實是好的。"
    )
