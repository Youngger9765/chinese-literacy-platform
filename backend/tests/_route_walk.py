"""走遍 FastAPI 的路由表 —— 包含被巢狀包起來的那些。

⚠️ 為什麼需要這個：新版 FastAPI（實測 0.141.1）把 `include_router()` 進來的東西
包成 `_IncludedRouter`。它**沒有 `.path`，也沒有 `.routes`** ——
真正的路由住在 `.original_router.routes`，另外 `.effective_route_contexts`
會 yield 帶 `.route` 的 context。舊版（0.115.6）則是直接攤平在 `app.routes` 裡。

同一段自省 code 於是有兩種死法，而兩種都不會說實話：

  for r in app.routes: r.path            → AttributeError（至少會叫）
  for r in app.routes:
      if hasattr(r, "path"): ...         → **靜默跳過**，被包起來的路由
                                            從此「不存在」，斷言說「路由沒註冊」

第二種比第一種糟：它看起來像是「重構把路由弄丟了」，而實際上路由好好的，
是走訪的方式看不到它。舊版 FastAPI 永遠重現不到。

⛔ 用這支的地方一律要配一條**下限斷言**（走到的條數 > 0 / >= N）。
   沒有它，走訪壞掉跟「真的沒有那條路由」在畫面上一模一樣 ——
   本檔第一版就是這樣，只走到 9 條，是那條下限斷言把我自己抓出來的。
"""

from __future__ import annotations


def _children(r):
    """這個節點底下還藏著哪些路由物件（不呼叫任何東西，只讀屬性）。"""
    nested = getattr(r, "routes", None)
    if nested:
        return list(nested)
    # `_IncludedRouter` 的 `original_router.routes` 是**還沒套前綴**的
    # （`/classrooms/{id}` 而不是 `/api/classrooms/{id}`），所以優先走這條：
    # `effective_route_contexts()` 給的 `_EffectiveRouteContext` 自己就是路由物件
    # （有 `path` / `methods`），而且 path 已經套好前綴。
    ctxs = getattr(r, "effective_route_contexts", None)
    if ctxs is not None:
        try:
            items = list(ctxs() if callable(ctxs) else ctxs)
        except Exception:
            items = []
        if items:
            return items
    orig = getattr(r, "original_router", None)   # 後備：舊/新版之間的過渡形狀
    if orig is not None and hasattr(orig, "routes"):
        return list(orig.routes)
    return []


def walk_routes(app):
    """Yield 每一個真正的路由物件（有 `.path` 的），巢狀的也算。"""
    stack = list(getattr(app, "routes", []))
    seen: set[int] = set()
    while stack:
        r = stack.pop()
        if id(r) in seen:
            continue
        seen.add(id(r))
        stack.extend(_children(r))
        if hasattr(r, "path"):
            yield r


def route_paths(app) -> set[str]:
    return {r.path for r in walk_routes(app)}


def method_paths(app) -> set[tuple[str, str]]:
    out = set()
    for r in walk_routes(app):
        for m in getattr(r, "methods", ()) or ():
            out.add((m, r.path))
    return out
