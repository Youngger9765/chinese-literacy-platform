"""課級模組（沒有 slug 的那些）也要被載進來。

#2916 把模組檔名一律改成 `{模組}.{slug}.yml`，載入端跟著改成
`vdir.glob("*.*.yml")`，並在註解裡寫「沒有『有 slug／沒 slug』兩種分支了」。

但**課級的檔沒有 slug** —— `metadata.yml`、`errata.yml` 只有一個點，
`*.*.yml` 需要兩個點，所以它們從此配不到：

    by_mod 沒有 metadata  →  MODULES 迴圈 skip
    →  lesson dict 沒有 "metadata" key
    →  _meta(l) 回 {}
    →  intro 永遠 None  →  **175 課的課程簡介整頁空白**

而 174 份 metadata.yml 的 intro 一直好好躺在磁碟上。
那正是 #2736 修過一次的同一個症狀，換一個機制回來。

⛔ 這條鎖住「載入端要看得到課級檔」，不是只鎖 intro ——
   errata 也是課級的，只鎖 intro 的話 errata 還是會靜靜消失。
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.lesson_uid_loader import MODULES  # noqa: E402

_LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"

#: 課級模組 —— 一課一份，檔名沒有 slug
COURSE_LEVEL = ("metadata", "errata")


def _load(uid: str):
    """⚠️ 要驗**原始載入端**，不是 search_lessons()。

    search_lessons() 回的是轉換後的 row —— `metadata` 已經被消費成 intro 等欄位、
    不再外露。拿 row 去斷言「有沒有 metadata key」會永遠是 False，
    不管載入端是好是壞（我第一版就是這樣打錯層）。
    """
    from app.services.lesson_uid_loader import load_lesson
    l = load_lesson(uid)
    assert l, f"載不到 {uid}"
    return l


def test_the_course_level_files_exist_on_disk():
    """正向對照 —— 少了它，下面在檔案本來就沒有的情況下也會綠。"""
    n = len(list(_LESSONS.glob("L*/v3/metadata.yml")))
    assert n >= 150, f"磁碟上只有 {n} 份 metadata.yml，這條在測空氣"


def test_course_level_modules_reach_the_lesson_dict():
    """⭐ 課級模組要出現在 lesson dict 裡。"""
    l = _load("L0070")   # 這課 metadata 與 errata 都有
    missing = [m for m in COURSE_LEVEL
               if (_LESSONS / "L0070" / "v3" / f"{m}.yml").exists() and m not in l]
    assert not missing, (
        f"這些課級模組在磁碟上但沒被載進來：{missing}\n"
        "載入端的 glob 只認 `{模組}.{slug}.yml`（兩個點），"
        "而課級檔沒有 slug、只有一個點。")


def test_the_intro_survives_all_the_way_to_the_row():
    """簡介要走到消費端 —— 這是學生會看到的那個欄位。"""
    from app.services.lesson_loader import search_lessons
    ls = search_lessons()
    assert len(ls) >= 150, f"只讀到 {len(ls)} 課"
    with_intro = [x for x in ls if (x.get("intro") or {}).get("background")]
    assert len(with_intro) >= 150, (
        f"只有 {len(with_intro)} 課的 intro 走到消費端，"
        f"而磁碟上有 {len(list(_LESSONS.glob('L*/v3/metadata.yml')))} 份 metadata.yml。\n"
        "抽對了、寫進去了、學生看不到 —— 又是這個形狀。")


def test_every_slugless_file_on_disk_is_registered_as_course_level():
    """⭐ 語料庫裡每一種**無 slug 的檔**都要登記成課級 —— 不靠人記得補。

    `COURSE_LEVEL_MODULES` 是手維護的清單。手維護的清單只會保護到
    「上次出事的那幾個」——`multi_text_parts.yml`（4 課、前端有 9 處在讀）
    就是這樣被漏掉的，而它跟 metadata 是同一個病。
    """
    from app.services.lesson_uid_loader import COURSE_LEVEL_MODULES, MODULES
    plain = set()
    for p in _LESSONS.glob("L*/v3/*.yml"):
        if p.stem.startswith("_") or p.stem == "lesson":
            continue
        if "." not in p.stem:          # 檔名沒有 slug ＝ 課級
            plain.add(p.stem)
    assert plain, "掃不到任何無 slug 的檔 —— 這條在測空氣"
    missing = sorted(m for m in plain if m in MODULES and m not in COURSE_LEVEL_MODULES)
    assert not missing, (
        f"這些檔沒有 slug（課級），但沒登記進 COURSE_LEVEL_MODULES：{missing}\n"
        "載入端的 glob 需要兩個點，它們配不到 —— 會靜靜地整個模組消失。")

