"""難字 fallback 改成年級字頻（#3247）

## 這支鎖什麼

家長實測（2026-09-17）：難字模式標了「之 加 千 同 大 失 小 手 成」這種四年級
早就會的字，而「都是八哥」那課**一個字都不標**。

根因在前端 `buildDifficultCharSet(story.vocabulary)` —— 把本課生詞拆成單字當難字。
生詞是**課程的屬性**，難字是**讀者的屬性**，於是

    「人」來自「寒氣逼人」·「水」「石」來自「滴水穿石」 → 早就會了卻每次都標
    生詞欄位是空的那課                                → 整個功能靜音

#3224 已經把「這孩子唸錯過的字」那條路接對了。這支鎖的是**還沒有錯字紀錄**時
（第一次玩的孩子 —— 也就是最需要鷹架的那一刻）走的那條 fallback。

## 判定

難 = 這個字在整套教材裡**少見**（出現課數 < 總課數的 `cut_ratio`）
     且**不是更低年級就教過的**（首見年級 >= 本課年級）

兩條都是從這 179 課的課文本文算出來的，不需要外部字表。

⚠️ 四年級是這套教材的**地板**，「更低年級教過」那條篩不掉任何東西 ——
   所以 G4 幾乎全靠字頻那條。這不是 bug，是資料邊界；真正的解是接教育部分年字表，
   在那之前字頻是可得的最佳代理（實測 G4 標記率 3.3%，跟其他年級同量級）。
"""
from __future__ import annotations

import re

import pytest

from app.services.lesson_zhuyin import lesson_hard_chars, char_difficulty_table, lesson_body_text

_CJK = re.compile(r"[㐀-䶿一-鿿\U00020000-\U0002FA1F]")

# 家長在真機上點名「明明很簡單卻標了注音」的字（四年級「運動科學」L0019）
_PARENT_FLAGGED_EASY = "之加千同大失小手成"


def test_parent_flagged_easy_chars_are_no_longer_difficult():
    """#3247 的原始回報：這九個字在四年級課文不該被標。"""
    hard = lesson_hard_chars("L0019")
    assert hard is not None, "L0019 要有難字集合"
    still = [c for c in _PARENT_FLAGGED_EASY if c in hard]
    assert still == [], f"這些字還是被標成難字：{''.join(still)}"


def test_genuinely_rare_chars_are_still_difficult():
    """反面：真的少見的字要留著，否則上面那條用「全部不標」就能作弊。"""
    hard = lesson_hard_chars("L0135")   # 九年級「都是八哥」
    assert hard is not None
    for ch in "喙聒":
        assert ch in hard, f"{ch} 應該是難字（九年級課文，全庫只出現在極少數課）"


def test_no_lesson_is_silently_empty():
    """生詞 0 的課以前整個功能靜音 —— 現在每一課都要有東西。

    這條是原始症狀的另一半：使用者看到的是「開關壞了」。
    """
    from app.services.lesson_uid_loader import available_uids

    empty = []
    for uid in sorted(available_uids()):
        hard = lesson_hard_chars(uid)
        # ⛔ 守衛不可以寫成 `hard is not None and len(hard) == 0` ——
        #    回 None 的課（找不到課文本文）會從那個條件溜走，而那正是這條要抓的
        #    症狀之一。2026-09-17 複審抓到：11 課的課文不在 `full_text_annotate`
        #    底下（10 課文言文 + L0136），它們全部回 None、生詞也都是 0，
        #    於是畫面上一個字都不標，而這條測試看不到。
        if hard is None or len(hard) == 0:
            empty.append(f"{uid}({'None' if hard is None else '空集合'})")
    assert empty == [], f"這些課沒有難字：{empty[:12]}"


def test_punctuation_never_marked():
    """`buildDifficultCharSet` 只濾空白，所以生詞裡的「，」會變成難字。"""
    for uid in ("L0003", "L0019", "L0135"):
        hard = lesson_hard_chars(uid) or set()
        bad = [c for c in hard if not _CJK.match(c)]
        assert bad == [], f"{uid} 的難字集合有非漢字：{bad}"


def test_hard_chars_actually_appear_in_that_lesson():
    """難字必須真的出現在這一課 —— 否則標了也看不到，等於沒做。"""
    from app.services.lesson_zhuyin import lesson_body_text

    for uid in ("L0003", "L0019", "L0135"):
        body = lesson_body_text(uid) or ""
        hard = lesson_hard_chars(uid) or set()
        missing = [c for c in hard if c not in body]
        assert missing == [], f"{uid} 的難字不在課文裡：{missing[:5]}"


def test_table_has_provenance():
    """表要說得出自己怎麼來的 —— 不然三個月後沒人知道 cut 是誰訂的。"""
    t = char_difficulty_table()
    assert t["total_lessons"] > 0
    assert 0 < t["pick_ratio"] < 1
    assert t["_provenance"]["generator"].endswith("generate_char_difficulty.py")
    assert len(t["chars"]) > 1000


def test_marking_rate_is_a_scaffold_not_a_wall():
    """標太多就退化成全注音，標太少就沒有鷹架 —— **每一課**都要落在 0.5%–12%。

    ⚠️ 2026-09-17 複審抓到：上一版只 parametrize 了 `L0003 / L0019 / L0135` 三課，
    而同一條斷言套到全部 168 課時有 **21 課低於 0.5%**（最慘的 L0147 是
    1/1092 = 0.09%，一千字標一個字），其中 19 課是九年級帶。
    也就是「測試寫著一個標準，然後抽樣抽在合格的那三課上」。

    所以這條跑全語料。逐課取比例的規則讓量由構造保證，抽樣沒有意義了。
    """
    from app.services.lesson_uid_loader import available_uids
    from app.services.lesson_zhuyin import lesson_body_text

    bad = []
    checked = 0
    for uid in sorted(available_uids()):
        body = [c for c in (lesson_body_text(uid) or "") if _CJK.match(c)]
        if not body:
            continue
        checked += 1
        hard = lesson_hard_chars(uid) or set()
        marked = sum(1 for c in body if c in hard)
        rate = marked / len(body)
        if not (0.005 <= rate <= 0.12):
            bad.append(f"{uid} {rate:.2%}（{marked}/{len(body)}）")
    assert checked > 150, f"只檢查了 {checked} 課 —— 語料沒抓到，這條等於沒測"
    assert bad == [], f"{len(bad)} 課的標記率落在 0.5%–12% 之外：{bad[:12]}"


def test_grade_preference_excludes_chars_taught_earlier():
    """年級偏好要真的有作用 —— 低年級就教過的字不該排在這個年級的新字前面。

    ## 這條測試被改寫過兩次，兩次都是因為它空轉

    ⚠️ 第一版（全域門檻時期）鎖 L0142 G9 的「麵 餅 熊 烤」。把年級條件整條刪掉，
       當時的 9 條測試**全部照樣綠** —— 年級那個維度完全沒被鎖住。
    ⚠️ 第二版把案例換成 L0083 的「忠 浴 鹽」並加了前提斷言。規則改成逐課取比例
       之後，那三個字就算純按罕見度排也擠不進前 k 個 → **還是抓不到 mutation**。

    所以第三版不挑字，改成**直接比對兩種排序的差集**：同一課、同一個 k，
    「有年級偏好」與「純罕見度」各取一次，差集就是年級偏好的作用本身。
    差集空 = 年級偏好沒作用 = 這條會紅。不可能空轉。

    案例 L0057 是六年級課文，純罕見度排序會把「咖」「啡」（都是首見 G4、各 3 篇）
    標成難字 —— 對六年級的孩子，那跟家長回報的「之 加 千 同」被標是同一件事。

    ⚠️ 下面算 `without_grade` 時**最後一個排序鍵（字本身）不能省** —— 少了它就是
       在算一個不定序的集合，案例會隨行程的雜湊種子時好時壞。這個坑我踩過。
    """
    uid = "L0057"
    table = char_difficulty_table()
    grade = table["lesson_grade"][uid]
    chars = table["chars"]

    body = set(lesson_body_text(uid) or "")
    cand = [(c, chars[c]) for c in body if c in chars]
    k = max(3, round(table["pick_ratio"] * len(cand)))
    # 純罕見度（= 拿掉年級偏好）會選出什麼
    without_grade = {c for c, _ in sorted(cand, key=lambda kv: (kv[1][1], kv[0]))[:k]}

    hard = lesson_hard_chars(uid)
    assert hard is not None
    assert len(hard) == k, f"取的數量要等於 k（{len(hard)} vs {k}）"

    only_without = without_grade - set(hard)
    assert only_without, (
        f"{uid} 兩種排序選出一樣的字 —— 年級偏好在這一課沒有作用，"
        "這條測試量不到東西，換一課當案例"
    )

    # 這一課實際被年級偏好擋掉的字，都必須是「低年級就教過的」
    for ch in only_without:
        first_grade, _ = chars[ch]
        assert first_grade < grade, (
            f"{ch} 首見 G{first_grade} 不早於本課 G{grade}，不該是被年級偏好擋掉的"
        )

    # 點名兩個七年級一定會的字（人看得懂的具體案例，不只是集合運算）
    for ch in "咖啡":
        assert ch in body, f"{ch} 不在 {uid} 的課文裡，換案例"
        assert ch in without_grade, f"{ch} 純罕見度排序沒選到 —— 這個案例失效了，換一課"
        assert ch not in hard, f"{ch}（首見 G{chars[ch][0]}）不該對 G{grade} 的孩子標成難字"


def test_marking_rate_is_a_scaffold_not_a_wall():
    """標太多就退化成全注音，標太少就沒有鷹架 —— **每一課**都要落在 0.5%–12%。

    ⚠️ 2026-09-17 複審抓到：上一版只 parametrize 了 `L0003 / L0019 / L0135` 三課，
    而同一條斷言套到全部 168 課時有 **21 課低於 0.5%**（最慘的 L0147 是
    1/1092 = 0.09%，一千字標一個字），其中 19 課是九年級帶。
    也就是「測試寫著一個標準，然後抽樣抽在合格的那三課上」。

    所以這條跑全語料。逐課取比例的規則讓量由構造保證，抽樣沒有意義了。
    """
    from app.services.lesson_uid_loader import available_uids
    from app.services.lesson_zhuyin import lesson_body_text

    bad = []
    checked = 0
    for uid in sorted(available_uids()):
        body = [c for c in (lesson_body_text(uid) or "") if _CJK.match(c)]
        if not body:
            continue
        checked += 1
        hard = lesson_hard_chars(uid) or set()
        marked = sum(1 for c in body if c in hard)
        rate = marked / len(body)
        if not (0.005 <= rate <= 0.12):
            bad.append(f"{uid} {rate:.2%}（{marked}/{len(body)}）")
    assert checked > 150, f"只檢查了 {checked} 課 —— 語料沒抓到，這條等於沒測"
    assert bad == [], f"{len(bad)} 課的標記率落在 0.5%–12% 之外：{bad[:12]}"


def test_grade_clause_excludes_chars_taught_earlier():
    """年級那條規則要真的有作用 —— 罕見但低年級就教過的字不算難。

    ⚠️ 這條是 2026-09-17 mutation 補上的：把 `first_grade >= grade` 整條刪掉，
    原本 9 條測試**全部照樣綠**。也就是說年級那個維度當時完全沒有被鎖住。

    案例是同一型缺陷換個年級：L0083 是七年級課文，「忠 浴 鹽」在這 175 篇裡確實
    少見（各 3 篇），但都是四年級就教過的字 —— 對七年級的孩子標注音，跟家長回報的
    「之 加 千 同」被標是同一件事。

    ⚠️ 原本用 L0142 / 麵餅熊烤，規則從「全域門檻」改成「逐課取比例」之後那一課的
    「新字」不足 k 個（10 < 17）→ 排序會放寬 → 那條測試會變成空轉。**是下面那個
    前提斷言自己叫出來的**，不是我發現的 —— 所以那個前提要留著。
    """
    uid = "L0083"
    hard = lesson_hard_chars(uid)
    assert hard is not None

    table = char_difficulty_table()
    grade = table["lesson_grade"][uid]

    # 前提：這一課「這個年級才新出現的罕見字」要**夠多**，否則排序會放寬到
    # 低年級出現過的字，這條測試就變成空轉（而不是在測年級偏好）
    body = set(lesson_body_text(uid) or "")
    cand = [(c, table["chars"][c]) for c in body if c in table["chars"]]
    k = max(3, round(table["pick_ratio"] * len(cand)))
    new_here = [c for c, (fg, _) in cand if fg >= grade]
    assert len(new_here) >= k, (
        f"{uid} 只有 {len(new_here)} 個「G{grade} 才新出現」的字但要取 {k} 個 —— "
        "排序會放寬，這條測試量不到年級偏好，換一課當案例"
    )

    for ch in "忠浴鹽":
        first_grade, n = table["chars"][ch]
        assert first_grade < grade, f"{ch} 首見 G{first_grade} 不早於本課 G{grade}"
        assert ch not in hard, f"{ch}（首見 G{first_grade}）不該對 G{grade} 的孩子標成難字"

    # 正向對照：這一課仍然要標得出東西，否則「全部不標」也會讓上面全過
    assert len(hard) > 0, f"{uid} 一個難字都沒有 —— 上面的斷言等於沒測"


def test_pick_is_deterministic_across_processes():
    """同一課在不同後端實例必須給同一組難字。

    ⚠️ 2026-09-17 實測過的失敗形狀：候選來自 `set(body)`，而 `sorted` 是穩定排序 ——
    出現次數相同的字，取誰取決於 `set` 的迭代序，也就是 Python 的字串雜湊種子。
    後端重啟一次就換一批難字，畫面上看不出任何異常。

    所以這條在**另一個 Python 行程**（不同 `PYTHONHASHSEED`）算一次再比對。
    只在同一個行程裡呼叫兩次是測不到的 —— 那是同一個雜湊種子。
    """
    import json
    import os
    import subprocess
    import sys
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    code = (
        "import sys; sys.path.insert(0, %r);"
        "from app.services.lesson_zhuyin import lesson_hard_chars;"
        "import json; print(json.dumps({u: ''.join(sorted(lesson_hard_chars(u) or []))"
        " for u in ('L0003','L0019','L0084','L0135','L0155')}))" % str(backend)
    )
    seen = []
    for seed in ("0", "1", "12345"):
        env = {**os.environ, "PYTHONHASHSEED": seed}
        out = subprocess.run([sys.executable, "-c", code], capture_output=True,
                             text=True, env=env, cwd=str(backend))
        assert out.returncode == 0, out.stderr[-500:]
        seen.append(json.loads(out.stdout))
    assert seen[0] == seen[1] == seen[2], (
        "不同 PYTHONHASHSEED 給出不同難字 —— 平手時的取捨不是決定性的：\n"
        + "\n".join(json.dumps(x, ensure_ascii=False) for x in seen)
    )
    assert all(v for v in seen[0].values()), "有課回空集合，這條測試等於沒測"
