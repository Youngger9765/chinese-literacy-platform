"""服務端送出去的 worksheet URL 一定要走自家 `/assets/` 代理。

背景（#2486）：`lingoleap-assets` bucket 已經收成 private，
任何直接指向 `storage.googleapis.com` 的絕對 URL 到了學生瀏覽器就是 403。

#2748 記的是「四條測試迭代空集合、恆綠」。那四條已經被改寫成掃 uid tree 的 175 課，
**但我用 issue 裡同一個 mutation 複驗，它們照樣全綠** ——
把 `_to_asset_proxy_url` 改成永遠回絕對 URL，同檔 6 條單元測試轉紅，那組整合測試沒動。

原因不是測試寫錯，是**現行語料裡那兩個欄位全是空的**，斷言的對象根本不存在：

    uid tree 含 storage.googleapis.com 的檔案數   0
    線上 175 課 payload 含絕對 GCS URL 的處數      0

所以「不變量成立」目前靠的是**資料剛好乾淨**，不是程式擋著 ——
`app/routes/stories.py` 是 `story.get("worksheet_pdf_url")` 原封不動傳出去的，
uid（v3）這條路徑上沒有任何一處呼叫 `_to_asset_proxy_url`
（legacy Layer1/Layer2 loader 裡那三處管的是另一條路）。

這支測試鎖的是「程式會擋」，不是「資料剛好乾淨」。
"""
from __future__ import annotations

from app.services.lesson_layer_loaders import _to_asset_proxy_url

ABSOLUTE = "https://storage.googleapis.com/lingoleap-assets/worksheets/G4-L1.pdf"


def test_the_rewriter_itself_turns_an_absolute_url_into_a_proxy_path():
    """正向對照：先證明改寫器本身是好的，後面那條紅了才知道是接線沒接。"""
    out = _to_asset_proxy_url(ABSOLUTE)
    assert out is not None
    assert "storage.googleapis.com" not in out
    assert out.startswith("/assets/"), out


def _story_payload(monkeypatch, story: dict) -> dict:
    """把一筆自造的 story 餵進真正的 `/api/stories/{id}` 路由，回它送出去的 JSON。

    ⚠️ 不是呼叫某個 helper —— 回應是在路由裡直接組的，
    只有走真路由才能證明「送到瀏覽器的那份」是對的。
    """
    from fastapi.testclient import TestClient
    import app.routes.stories as stories_mod
    from app.main import app as fastapi_app

    monkeypatch.setattr(stories_mod, "get_lesson_by_id", lambda _id: story)
    with TestClient(fastapi_app) as client:
        r = client.get(f"/api/stories/{story['id']}")
    assert r.status_code == 200, r.text
    return r.json()


def _base_story(**over) -> dict:
    """拿一筆**真的**課當底，只覆蓋要測的欄位。

    自己從零編 dict 會漏掉路由用 `story["..."]` 直接取的欄位（漏一個就 500），
    而且編出來的形狀不保證跟真的一樣 —— 今天已經被自造 fixture 咬過兩次。
    """
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    assert lessons, "載不到任何課 —— 這條測試沒有底可用，不是通過"
    base = dict(lessons[0])
    base.update(over)
    return base


def test_served_story_never_hands_out_an_absolute_worksheet_url(monkeypatch):
    """⚠️ 刻意**不**掃現行語料 —— 那種斷言在資料乾淨時恆真，正是 #2748 的病。
    這條自己造一筆會踩雷的資料。"""
    payload = _story_payload(monkeypatch, _base_story(
        worksheet_pdf_url=ABSOLUTE,
        worksheet_docx_url=ABSOLUTE.replace(".pdf", ".docx"),
    ))
    pdf = payload.get("worksheet_pdf_url")
    docx = payload.get("worksheet_docx_url")
    assert pdf and "storage.googleapis.com" not in pdf, (
        f"送到學生瀏覽器的是絕對 GCS URL，bucket 是 private → 403：{pdf}"
    )
    assert docx and "storage.googleapis.com" not in docx, docx


def test_relative_and_empty_values_pass_through_unchanged(monkeypatch):
    """負向對照：改寫器冪等，已經是代理路徑或空值不可以被動到。"""
    payload = _story_payload(monkeypatch, _base_story(
        worksheet_pdf_url="/assets/worksheets/G4-L1.pdf",
        worksheet_docx_url=None,
    ))
    assert payload.get("worksheet_pdf_url") == "/assets/worksheets/G4-L1.pdf"
    assert payload.get("worksheet_docx_url") is None
