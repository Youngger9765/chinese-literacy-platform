"""念順順起訖：golden set 回歸鎖（#2912）

⚠️ 為什麼存在：2026-08-24 為了擋計數欄雜訊加了一道比率門檻，造成 20 課 regression。
   當時**也有**回測組，但那組只挑「本來就會過」的課 —— 全在門檻之上，什麼都沒抓到。
   所以這份 golden set 的收錄原則是**兩邊都要有邊緣值**，理由逐課寫在 fixture 裡。

這支只驗**出貨的資料**（快，CI 跑得動）。改抽取器邏輯時要另外跑
`scripts/key_reading_golden_check.py`，那支會真的重跑抽取（要轉檔，慢）。
"""

import pathlib

import yaml

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"
GOLDEN = pathlib.Path(__file__).resolve().parent / "fixtures" / "key_reading_golden.yml"


def _golden() -> dict:
    return yaml.safe_load(GOLDEN.read_text(encoding="utf-8"))


def _key_reading(uid: str) -> dict:
    f = LESSONS / uid / "v3" / "key_reading.yml"
    if not f.is_file():
        return {}
    d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    return d.get("key_reading") or d


def _norm(text: str) -> str:
    import re
    return re.sub(r"[\s　]", "", text or "")


def test_golden_lessons_carry_the_range_the_worksheet_marks():
    """每一課的 start_idx / end_idx / 字數要跟 golden set 一致。

    逐課判定 —— 一課一個 verdict，失敗訊息列出是哪幾課、差在哪。
    ⛔ 不看中位數、不看通過比例。
    """
    wrong = []
    for uid, (start, end, chars, why) in _golden()["must_resolve"].items():
        kr = _key_reading(uid)
        got = (kr.get("start_idx"), kr.get("end_idx"), len(_norm(kr.get("passage"))))
        if got != (start, end, chars):
            wrong.append(f"  {uid} 應 ({start}, {end}, {chars}) 實際 {got} — {why}")
    assert wrong == [], "golden set 對不上：\n" + "\n".join(wrong)


def test_every_golden_lesson_still_exists():
    """golden set 引用的課必須存在。

    **沒有這條會怎樣**：上面那條是走訪 golden set 逐課比對。課一旦被刪掉或改 uid，
    它就少驗幾課而**照樣全綠** —— 覆蓋範圍縮小是靜默的，這是 gate 最常見的死法。
    """
    g = _golden()
    missing = [uid for uid in list(g["must_resolve"]) + list(g["must_not_resolve"])
               if not (LESSONS / uid / "v3").is_dir()]
    assert missing == [], f"golden set 指到不存在的課：{missing}"


def test_the_golden_set_keeps_its_edge_cases():
    """收錄原則本身也要鎖住。

    這條擋的是「有人為了讓測試變綠，把難的課從 golden set 拿掉」——
    那正是 2026-08-24 那次 regression 沒被抓到的原因（回測組只有好走的課）。
    """
    g = _golden()
    edge_resolve = {u for u, v in g["must_resolve"].items() if "🔴 邊緣" in v[3]}
    edge_block = {u for u, v in g["must_not_resolve"].items() if "🔴 邊緣" in v[1]}
    assert edge_resolve >= {"L0173", "L0054", "L0047"}, (
        f"must_resolve 的邊緣樣本被拿掉了：現在只有 {sorted(edge_resolve)}。"
        "那些是計數欄吻合率最低、最容易被新過濾誤擋的課"
    )
    assert edge_block >= {"L0091"}, (
        "must_not_resolve 的邊緣樣本被拿掉了。L0091 的雜訊吻合率 87%，"
        "比某些真計數欄還高 —— 少了它就看不出過濾是不是只會擋明顯的"
    )
