"""重點表 QA 看板不可以再去公開 hosting 抓學習單原稿（#3192）。

為什麼
------
看板原本這樣取原稿：

    const WS_HOST = "https://lingoleap-dev.web.app";
    `${WS_HOST}/assets/worksheets/${L.lesson_code}.pdf`
    `${WS_HOST}/assets/worksheets/${L.lesson_code}.docx`

那個路徑下**一個檔都沒有** —— 實測每一課都 404，負向對照（不存在的路徑）同樣 404，
所以「docx ↔ 實際渲染對照」這個看板存在的理由在遠端等於不成立。

⛔ 而「把檔案放上去」是**錯的解法**：`lingoleap-dev.web.app` 是**無需登入**的公開
Firebase Hosting（不帶任何憑證 curl 得到），把 179 份教師版學習單放上去等於公開
發佈案主的教材，而這個 repo 本身也是 PUBLIC。

原稿住在私有 bucket，由 `GET /api/lessons/{uid}/worksheet/teacher` 驗證後提供
（#3276 已經在 React app 裡這樣用）。看板跟 app 同源，讀得到 app 存的 token。

⛔ 也不要改用看板自己的 `x-qa-token`：那是共用密鑰，拿它換教材等於把存取範圍
從「登入的老師」擴大到「拿到那串密鑰的任何人」。
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BOARD = REPO / "frontend" / "public" / "keypoints-qa" / "app.js"
AUTHED_ENDPOINT = "/worksheet/teacher"


def _src() -> str:
    return BOARD.read_text(encoding="utf-8")


def test_the_board_file_is_there() -> None:
    """對照組：檔案被搬走時，下面每一條都會變成空斷言。"""
    assert BOARD.is_file(), f"找不到 {BOARD.relative_to(REPO)}"
    s = _src()
    assert len(s) > 2000 and "keypoints" in s.lower() or "QA" in s, "這看起來不是那個看板"


def test_no_worksheet_fetched_from_public_hosting() -> None:
    """不可以再有任何「去公開 hosting 抓 worksheet」的路徑。"""
    bad = [
        ln.strip()
        for ln in _src().splitlines()
        if re.search(r"assets/worksheets/", ln) and not ln.strip().startswith("//")
    ]
    assert not bad, (
        "看板還在從公開 hosting 抓學習單原稿：\n  " + "\n  ".join(bad) +
        "\n⛔ 那個路徑是空的（每一課 404），而補上檔案＝把案主教材公開發佈。"
        "\n→ 走 `GET /api/lessons/{uid}/worksheet/teacher`（驗證後從私有 bucket 提供）。"
    )


def test_the_board_uses_the_authenticated_endpoint() -> None:
    s = _src()
    assert AUTHED_ENDPOINT in s, (
        f"看板沒有用 `{AUTHED_ENDPOINT}` —— 那是原稿唯一不外流的取得方式"
    )
    assert "Authorization" in s and "Bearer" in s, (
        "打那個端點要帶 Bearer token，否則一律 401"
    )


def test_the_board_does_not_trade_the_shared_qa_token_for_teaching_material() -> None:
    """`x-qa-token` 是共用密鑰，只能用在 QA 的存讀，不可以拿來換教材。"""
    s = _src()
    for ln in s.splitlines():
        if AUTHED_ENDPOINT in ln or "worksheet/teacher" in ln:
            assert "x-qa-token" not in ln, (
                f"用共用密鑰換教材，等於把存取範圍從「登入的老師」擴大到"
                f"「拿到密鑰的任何人」：{ln.strip()}"
            )


def test_the_authenticated_endpoint_really_exists_and_is_gated() -> None:
    """正向對照：端點要真的在，而且真的要驗證 —— 否則上面幾條指向一個幻覺。"""
    route = (REPO / "backend" / "app" / "routes" / "worksheets.py").read_text(encoding="utf-8")
    assert '"/{lesson_uid}/worksheet/teacher"' in route, "後端沒有這個端點"
    block = route.split('"/{lesson_uid}/worksheet/teacher"', 1)[1][:600]
    # 實際的門比「有登入」更嚴：`require_role(*_TEACHER_TIER_ROLES)`，
    # 學生拿到 403。兩種都接受，但至少要有一種 —— 沒有門的話它跟公開 hosting 沒差別。
    assert "require_role" in block or "get_current_user" in block, (
        f"那個端點沒有任何權限門：\n{block[:200]}"
    )
    assert "_TEACHER_TIER_ROLES" in block, (
        "教師版原稿應該只給教師層級 —— 現在的門比這個寬，請確認是刻意的"
    )
