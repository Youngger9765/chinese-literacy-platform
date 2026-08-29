"""學習單章節標籤裡的破折號有四種寫法，路由表只認一種 —— 36 課因此掉了整個步驟。

`_SECTION_TO_STEP` 用字面比對，key 寫的是 `讀全文-做記號`（U+002D HYPHEN-MINUS）。
實際資料裡有 **36 課寫成 `讀全文—做記號`（U+2014 EM DASH）**，對不到就靜默跳過，
於是那 36 課的 `step_sequence` **完全沒有 `full-text-annotate`** ——
學生走學習流程時第二關直接不存在。

實測（2026-08-21，350 份 lesson.yml）：

    讀全文-做記號   U+002D   122 課   ← 路由表認得
    讀全文—做記號   U+2014    36 課   ← 認不得，全部掉步驟
    讀全文            （無破折號）  6 課

同一族還有三個標籤帶 U+2500（BOX DRAWINGS LIGHT HORIZONTAL，抽取管線的產物）
與 U+2014。

## 為什麼是正規化而不是加四條別名

加別名治的是「今天看到的那四個」。破折號的變體不只四種（U+2013 en dash、
U+2012 figure dash、U+2015 horizontal bar、U+FF0D fullwidth hyphen…），
每多一種就要有人再發現一次、再加一條。**比對前正規化**讓整族一次收斂。
"""
import sys, os
import pathlib
import re
import collections

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.lesson_indexes import _SECTION_TO_STEP, normalise_section_label

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"

#: 這個 repo 的資料裡實際出現過的破折號變體。
DASHES = "—–‒―─－−"


def _labels() -> collections.Counter:
    c: collections.Counter = collections.Counter()
    for p in LESSONS.glob("L*/v3/lesson.yml"):
        for m in re.finditer(r"^\s*name:\s*(.+)$", p.read_text(errors="ignore"), re.M):
            c[m.group(1).strip().strip("\"'")] += 1
    return c


class TestTheCorpusStillHasVariants:
    """前提。這些測試若在一份沒有變體的語料上跑，全部會空跑變綠。"""

    def test_there_are_lessons_to_check(self):
        labels = _labels()
        assert sum(labels.values()) >= 300, f"只掃到 {sum(labels.values())} 個標籤 —— 這條在測空氣"

    def test_the_em_dash_variant_is_still_in_the_data(self):
        """資料端沒被人手工改掉 —— 這個修正要能自己站住，不能依賴別人先清資料。"""
        labels = _labels()
        em = [k for k in labels if "—" in k]
        assert em, "語料裡已經沒有 em dash 變體了 —— 確認一下這個修正還有沒有必要"


class TestDashNormalisation:
    def test_every_dash_variant_maps_to_the_same_step(self):
        base = "讀全文-做記號"
        assert base in _SECTION_TO_STEP, "前提壞了：路由表沒有這條"
        want = _SECTION_TO_STEP[base]
        for d in DASHES:
            variant = base.replace("-", d)
            got = _SECTION_TO_STEP.get(normalise_section_label(variant))
            assert got == want, f"{variant!r}（U+{ord(d):04X}）對到 {got!r}，應該是 {want!r}"

    def test_normalising_does_not_merge_two_different_labels(self):
        """負向對照：正規化只碰破折號，不可以把不同標籤壓成同一個。

        少了這條，`return ''` 或「只留中文字」都會讓上面那條全綠。
        """
        seen: dict[str, str] = {}
        for label in _labels():
            n = normalise_section_label(label)
            if n in seen and seen[n] != label:
                # 只有破折號不同才允許碰撞
                a, b = seen[n], label
                stripped = [re.sub(f"[-{DASHES}]", "", x) for x in (a, b)]
                assert stripped[0] == stripped[1], f"兩個不同標籤被壓成同一個：{a!r} / {b!r}"
            seen.setdefault(n, label)

    def test_a_label_with_no_dash_is_untouched(self):
        for label in ("閱讀理解", "文章重點表", "品格聚光燈"):
            assert normalise_section_label(label) == label


class TestNoLessonSilentlyLosesTheStep:
    def test_every_lesson_printing_the_full_text_section_routes_to_the_step(self):
        """數量斷言：印了那個章節的課，一課都不可以掉步驟。

        修正前是 36 課全掉。用數量而不是「至少有一課對了」——
        這條線反覆出事的根因就是列舉不完全。
        """
        labels = _labels()
        printing = {k: v for k, v in labels.items() if k.startswith("讀全文") and len(k) > 3}
        assert printing, "沒有任何課印這個章節 —— 這條在測空氣"

        unrouted = {
            k: v for k, v in printing.items()
            if _SECTION_TO_STEP.get(normalise_section_label(k)) != "full-text-annotate"
        }
        assert not unrouted, (
            "這些寫法對不到 full-text-annotate，那些課的學生走不到「讀全文-做記號」：\n"
            + "\n".join(f"  ×{v} {k!r}" for k, v in unrouted.items())
        )


class TestTheLookupSiteActuallyNormalises:
    """驗接線，不只驗字典。

    🔴 這條是補的：把查表點的 `normalise_section_label(...)` 拿掉（= 只修一半），
    上面六條**照樣全綠** —— 它們只證明「正規化函式對」與「字典查得到」，
    沒有證明**真正查表的那一行有呼叫它**。
    """

    def test_a_lesson_whose_label_uses_an_em_dash_gets_the_step(self):
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from app.services.lesson_loader import get_all_lessons

        em_uids = {
            p.parts[-3]
            for p in LESSONS.glob("L*/v3/lesson.yml")
            if "讀全文—做記號" in p.read_text(errors="ignore")
        }
        assert len(em_uids) >= 10, f"只找到 {len(em_uids)} 課用 em dash —— 這條在測空氣"

        by_uid = {x.get("lesson_uid"): x for x in get_all_lessons()}
        missing = [
            u for u in sorted(em_uids)
            # `step_sequence` 的元素帶輪次後綴（`full-text-annotate#p3kud`，#2916）——
            # 用裸字串 `in` 比會全部對不上，量出「36/36 課都沒有」，
            # 而那 36 課的畫面上明明有那一步。
            if not any(k.split("#", 1)[0] == "full-text-annotate"
                       for k in ((by_uid.get(u) or {}).get("step_sequence") or []))
        ]
        assert not missing, (
            f"{len(missing)} / {len(em_uids)} 課的 step_sequence 仍然沒有 full-text-annotate —— "
            f"查表那一行沒有走正規化：{missing[:6]}"
        )

    def test_lessons_using_the_plain_hyphen_are_unaffected(self):
        """正向對照：本來就好的那 122 課不可以因為這個改動而壞掉。"""
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from app.services.lesson_loader import get_all_lessons

        plain = {
            p.parts[-3]
            for p in LESSONS.glob("L*/v3/lesson.yml")
            if "讀全文-做記號" in p.read_text(errors="ignore")
        }
        assert len(plain) >= 50, f"只找到 {len(plain)} 課用連字號 —— 對照失效"

        by_uid = {x.get("lesson_uid"): x for x in get_all_lessons()}
        missing = [
            u for u in sorted(plain)
            if u in by_uid and not any(k.split("#", 1)[0] == "full-text-annotate"
                                       for k in (by_uid[u].get("step_sequence") or []))
        ]
        assert not missing, f"原本正常的課掉了步驟：{missing[:6]}"
