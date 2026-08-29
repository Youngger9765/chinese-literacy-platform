"""加碼題不可以無聲消失（#2964，修 #2930 引入的 fail-open）。

#2930 把「第一篇專屬的加碼題」從頂層移進它所屬的那一篇 ——
否則第 2、3 篇的重點表底下也會出現「請依據第一篇文章的內容」。

放置的判斷是 `_article_order(l).get(slug) == fq["part_no"]`。
**但不是每一種加碼題都有 `part_no`**：

    L0063  part_no=1                    → 對到第 1 篇 ✅
    L0144  沒有 part_no（閱讀接力形狀，  → None 永遠對不到 1/2/3
           只有 text_ref / items）         每一篇都沒有、頂層又被設成 None
                                          **整節消失，而檔案在磁碟上**

那是 fail-open：對不到就什麼都不做。而「什麼都不做」在這裡等於刪掉一個大題。

⛔ 這條鎖的是「不可以消失」，不是「一定要在第幾篇」——
   放錯篇是內容問題，整節不見是學生少了一個大題。
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"
_MOD = "keypoints_followup_questions"


def _uids_with_followup_on_disk() -> list[str]:
    out = []
    for d in sorted(_LESSONS.glob("L*/v3")):
        if list(d.glob(f"{_MOD}*.yml")):
            out.append(d.parent.name)
    return out


def test_some_lessons_have_it_on_disk():
    """正向對照 —— 少了它，語料庫裡一份都沒有時下面也會綠。"""
    uids = _uids_with_followup_on_disk()
    assert len(uids) >= 2, f"磁碟上只有 {len(uids)} 課有加碼題，這條在測空氣"


def test_it_is_reachable_somewhere_for_every_lesson_that_has_one():
    """⭐ 磁碟上有，載完之後就一定要找得到 —— 頂層或某一篇，兩者其一。"""
    from app.services.lesson_loader import get_lesson_by_id, search_lessons

    by_uid = {l.get("lesson_uid"): l for l in search_lessons()}
    lost = []
    for uid in _uids_with_followup_on_disk():
        row = by_uid.get(uid)
        if row is None:
            continue
        story = get_lesson_by_id(row["id"]) or {}
        top = story.get(_MOD)
        rounds = story.get("repeat_rounds") or {}
        in_round = any(isinstance(v, dict) and v.get(_MOD) for v in rounds.values())
        if not top and not in_round:
            lost.append(uid)
    assert not lost, (
        f"這幾課的加碼題在磁碟上，載完之後頂層與每一篇都找不到：{lost}\n"
        "放置判斷對不上時什麼都不做 —— 而在這裡「什麼都不做」等於刪掉一個大題。")


def test_a_cross_part_followup_stays_at_the_top():
    """跨篇的加碼題要留在頂層 —— 挑其中一篇會讓「綜合」變成「其中一篇」。

    L0144 的閱讀接力 `text_ref` 是三篇的清單（`['wdnd7','dvxj6','4ymn7']`），
    標題也寫「從一位選手，到各項運動紀錄」—— 它本來就是跨篇的。

    這跟前端 `roundScope.ts` 既有的規則同一條：
    「跨篇的節（text_ref 是清單）→ 維持頂層資料」。
    ⛔ 兩邊的判準必須一致，否則後端塞進某一篇、前端又去頂層找，
       學生會在一篇看到它、在別篇看到空的。
    """
    from app.services.lesson_loader import get_lesson_by_id, search_lessons
    row = next(l for l in search_lessons() if l.get("lesson_uid") == "L0144")
    story = get_lesson_by_id(row["id"]) or {}
    fq = story.get(_MOD)
    assert fq, "L0144 的閱讀接力不在頂層"
    assert isinstance(fq.get("text_ref"), list), (
        f"這條的前提是 text_ref 是清單，實得 {fq.get('text_ref')!r} —— 資料換形狀了，重新判斷")
    rounds = story.get("repeat_rounds") or {}
    placed = [k for k, v in rounds.items() if isinstance(v, dict) and v.get(_MOD)]
    assert not placed, (
        f"跨篇的加碼題被塞進了 {placed} —— 那會讓「綜合」讀起來像「只講那一篇」")

