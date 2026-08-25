"""示範朗讀的年級交付規則 —— 唯一的一份。

來源：`docs/requirements/reading-demo-audio-qr.md` §R1

    4–7 年級   全文 + 念順順    QR code 2 個
    8–9 年級   只有念順順       QR code 1 個

## 為什麼獨立成一個模組

這兩個常數原本住在 `scripts/build_demo_reading.py`（#2622 的批次產生器），
而 `verify_qr_manifest.py`（run-ci 的 Gate 4）從那裡 import 它們。

2026-08-25 查證：那支批次產生器**已經沒有消費端**——
2026-08-10 的 #2622 後續把 QR 改成指向學習頁（`/learn/{id}/{step}`，走即時 TTS），
它就被留在原地；`demo-reading/` 在三顆 bucket 都是 0 個物件，
產出物也從來沒被提交過。腳本刪了，但**規則還是活的**，所以搬到這裡。

⛔ 不要把規則寫死在消費端。前端 `lessonQr.deliversFullText` 與這裡是同一條規則，
兩邊都改才算改完。
"""
from __future__ import annotations

#: 只交付念順順的年級
PASSAGE_ONLY_GRADES = {8, 9}
#: 全文與念順順都交付的年級
FULL_AND_PASSAGE_GRADES = {4, 5, 6, 7}


def grade_num(grade) -> int | None:
    """把 `grade` 收斂成數字年級；不是數字的回 None。

    🔴 `/api/stories` 的 `grade` 是**字串**（'4'…'9'，另有 `文言文` 12 課、
    `品格教育` 11 課）。直接拿字串去比整數集合，`'4' in {4,5,6,7}` 永遠是 False——
    2026-08-25 實測，`plan_demo_audio` 因此對全部 175 課產出 0 條，
    而且不報錯、只是安靜地什麼都不做。

    前端 `lessonQr.ts::deliversFullText` 早就處理了同一件事，這裡沿用它的判法。
    """
    if isinstance(grade, bool) or grade is None:
        return None
    if isinstance(grade, int):
        return grade
    try:
        return int(str(grade).strip())
    except ValueError:
        return None


def delivers_full_text(grade) -> bool:
    """這一課要不要交付全文音檔／全文 QR。"""
    return grade_num(grade) in FULL_AND_PASSAGE_GRADES


def delivers_passage(grade) -> bool:
    """這一課要不要交付念順順音檔／念順順 QR（4–9 年級都要）。"""
    n = grade_num(grade)
    return n in FULL_AND_PASSAGE_GRADES or n in PASSAGE_ONLY_GRADES
