"""QR 短網址 `/q/{slug}` → 那個大題現在的頁面（#2916）。

紙上只印代號，目的地留在我們這邊。老師把 QR 印進學習單、貼在教室，
那張紙我們收不回來 —— 所以紙上不可以有任何我們會改的東西
（網域、路由名、課的流水號、篇次，2026-08 都改過）。

⛔ 這支是**轉址**不是 API，所以它掛在根路徑不是 `/api` 底下：
   `/q/9a7x4` 是要給人掃的，愈短愈好，也不該長得像內部介面。
"""
from __future__ import annotations

import re

from fastapi import APIRouter
from fastapi.responses import RedirectResponse, JSONResponse

from ..services.slug_index import resolve, target_path

router = APIRouter()

#: 抽取器發的不透明代號：24 個字母的字母表、4-8 碼。
#: 收得嚴一點是為了讓「亂輸入」跟「真的退役了」分得開 ——
#: 兩者都轉到同一個地方的話，紙本印錯跟代號被撤掉會長得一模一樣。
_SLUG = re.compile(r"^[34679acdefhjkmnpqrtuvwxy]{4,8}$")


@router.get("/q/{slug}", include_in_schema=False)
def qr_redirect(slug: str):
    """掃 QR 進來的入口。

    查不到就回一個**說得出話的** 404，不要裸奔：拿著紙本的是老師和學生，
    他們需要知道「這個碼我們不認得」而不是看到一個空白頁。
    """
    s = (slug or "").strip().lower()
    if not _SLUG.match(s):
        return JSONResponse(
            status_code=404,
            content={"error": "unknown_code", "code": slug,
                     "message": "這個代號的格式不對，請確認紙本上的字有沒有看錯"},
        )
    entry = resolve(s)
    if not entry:
        return JSONResponse(
            status_code=404,
            content={"error": "unknown_code", "code": s,
                     "message": "查不到這個代號 —— 它可能已經退役，或這份學習單還沒上線"},
        )
    # 307：轉址是「現在在這裡」不是「永遠在這裡」。
    # ⛔ 不要用 301 —— 瀏覽器會永久快取，那等於把目的地也焊死在使用者的機器裡，
    #    而這整層存在的理由就是目的地要可以改。
    return RedirectResponse(url=target_path(entry), status_code=307)
