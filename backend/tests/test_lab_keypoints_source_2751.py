from _module_files import module_file, module_files
"""重點表的來源目錄隨一修刪掉了，儀表板因此把 150 課報成「沒有重點表」(#2751 症狀 2)。

`_SCHEMA_DIR` 指向 `private/curriculum-source/_online-schema` —— 那個目錄不在 repo 裡
（`private/` 整個是 gitignored），而 `_keypoints_path()` 找不到檔就回 `None`。
**它不會拋錯**，所以 `has_keypoints_yml` 對 175 課一致回 False，看起來像內容全沒了。

靜默降級比 500 難發現：500 有人會查，「0/175 內容缺失」只會讓人去查內容。
"""
import sys, os, pathlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.story_structure_lab_service import build_lab_index

DATA = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"


def _on_disk() -> int:
    return len(list(DATA.glob("L*/v3/keypoints.*.yml")))


def test_dashboard_counts_the_keypoints_that_are_actually_on_disk():
    """儀表板數到的重點表數，要等於磁碟上真的有的數目。

    下限存在的理由：磁碟上一課都沒有時 `0 == 0` 也會綠。那種情況要講出來，
    不是靜靜地通過。
    """
    disk = _on_disk()
    assert disk >= 100, (
        f"磁碟上只有 {disk} 課有 v3/keypoints.yml —— 這條在測空氣，不是儀表板對了"
    )

    result = build_lab_index()
    lessons = result["lessons"] if isinstance(result, dict) else result
    counted = sum(1 for x in lessons if x.get("has_keypoints_yml"))

    assert counted == disk, (
        f"儀表板說 {counted} 課有重點表，磁碟上其實有 {disk} 課。\n"
        "差距來自 _SCHEMA_DIR 指著已刪除的目錄，而找不到檔時是靜默回 None。"
    )


def test_every_call_site_passes_the_lesson_uid():
    """四個呼叫點都要帶 uid —— 「有一個對了」不是覆蓋率。

    第一版我只改了 `has_keypoints_yml` 那一處就看到綠燈，另外三處照樣只傳
    `parsed_code`。斷言用數量（總數達標 + 漏接數為 0）。

    用 AST 不用 regex：正規表示式掃的是文字，註解、docstring、字串裡寫一個假的
    呼叫就能灌高計數，而 `[^)]*` 碰到 `lesson.get("lesson_uid")` 會在內層右括號
    截斷 —— 現況能過只是碰巧。AST 看的是真的 Call 節點。
    """
    import ast

    src_path = (
        pathlib.Path(__file__).resolve().parents[1]
        / "app" / "services" / "story_structure_lab_service.py"
    )
    tree = ast.parse(src_path.read_text())

    TARGETS = {"_keypoints_path", "_read_keypoints"}
    calls = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Name)
        and n.func.id in TARGETS
    ]
    assert len(calls) >= 5, f"只找到 {len(calls)} 個呼叫節點 —— 這條在測空氣"

    def passes_uid(call: ast.Call) -> bool:
        args = list(call.args) + [kw.value for kw in call.keywords]
        return any("lesson_uid" in ast.dump(a) for a in args[1:])

    missing = [
        f"{src_path.name}:{c.lineno}  {c.func.id}(...)"
        for c in calls
        if not passes_uid(c)
    ]
    assert not missing, (
        f"{len(missing)} 個呼叫點沒帶 lesson_uid，那些課會繼續被判定成沒有重點表：\n"
        + "\n".join(f"  {m}" for m in missing)
    )


def test_detail_loads_the_keypoints_belonging_to_that_lesson():
    """行為測試：detail 真的讀到**那一課自己的**重點表。

    上面兩條一條數數量、一條看呼叫形狀，都不會發現「讀到別課的檔」。
    這條斷言路徑裡就是該課的 uid。
    """
    from app.services.story_structure_lab_service import build_lab_detail
    from app.services.lesson_loader import get_lesson_by_id

    result = build_lab_index()
    lessons = result["lessons"] if isinstance(result, dict) else result
    with_kp = [x for x in lessons if x.get("has_keypoints_yml")]
    assert len(with_kp) >= 100, f"只有 {len(with_kp)} 課有重點表 —— 這條在測空氣"

    checked = 0
    for row in with_kp[:20]:
        detail = build_lab_detail(row["story_id"])
        art = detail.get("artifacts", {})
        path = art.get("keypoints_path")
        assert path and path != "None", f"story {row['story_id']} 的 keypoints_path = {path!r}"
        # uid 從 loader 獨立解出來，不從被測的回應裡拿 —— 回應自報的東西
        # 不能用來驗證回應自己。（實際上這兩個回應都沒有 lesson_uid 欄位。）
        uid = (get_lesson_by_id(row["story_id"]) or {}).get("lesson_uid")
        assert uid, f"story {row['story_id']} 在 loader 裡查不到 uid"
        assert f"/{uid}/" in path, f"story {row['story_id']} 讀到別課的檔: {path}"
        checked += 1
        assert detail.get("keypoints"), f"story {row['story_id']} 的 keypoints 是空的"
    assert checked >= 10, f"只驗到 {checked} 課的 uid 對得上 —— 這條在測空氣"


def test_a_broken_keypoints_file_does_not_500_the_admin_route(tmp_path, monkeypatch):
    """壞掉的 YAML 要當成「沒有」，不可以打穿成 500。

    這條是補上來的 —— 我先加了 try/except，然後把它拿掉跑 mutation，
    **三條測試全綠**。沒有紅過的守衛就是裝飾品，所以有了這條。

    用 tmp_path，不碰真的 data/lessons。
    """
    from app.services import story_structure_lab_service as svc

    uid = "L9999"
    (tmp_path / uid / "v3").mkdir(parents=True)
    bad = tmp_path / module_file(uid / "v3", "keypoints")
    bad.write_text("這行沒問題\n  - 但這裡縮排壞了: [未閉合\n", encoding="utf-8")

    monkeypatch.setattr(svc, "_LESSONS_DIR", tmp_path)

    # 正向對照：路徑真的解到我剛建的那個檔（否則下面的 None 只代表「找不到」）
    assert svc._keypoints_path(None, uid) == bad

    assert svc._read_keypoints(None, uid) is None, (
        "壞掉的 YAML 應該回 None；會拋例外的話 admin detail 路由就是 500"
    )
