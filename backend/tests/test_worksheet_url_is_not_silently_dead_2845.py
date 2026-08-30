"""學習單 URL 這條線目前是斷的，而且斷得很安靜（#2845）。

2026-08-31 實測：

  `_derive_docx_url('G4-L1')` → '/assets/worksheets/G4-L1.docx'   ← 算得出來
  manifest 225 個 code，跟 API 的 grade_code 直接對得上 139 個
  但 `/api/stories?page_size=300` 的 175 課，**worksheet_docx_url 全是 None**

原因：唯一的消費者 `routes/stories.py` 只讀 yml 的欄位，**沒有呼叫 `_derive_docx_url`**
—— 而那支函式自己的 docstring 寫著「callers use `... or _derive_docx_url(grade_code)`」。
說明跟實作對不起來，而且不會有任何錯誤。

⛔ 現在**刻意不接**：`/assets/worksheets/*.docx` 在 staging 一律 404
（正向對照：同一個 proxy 拿縮圖回 200 / 17KB，所以 proxy 是好的，是檔案沒上傳）。
接上去只會讓 139 課長出一顆按下去就失敗的按鈕。

這條鎖守的是**這件事保持可見**：等檔案上傳之後，要嘛把它接上、要嘛更新這裡的說明，
不可以讓「算得出來但沒人用」這個狀態靜靜地活著。
"""
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

STORIES = REPO / "backend/app/routes/stories.py"
LOADERS = REPO / "backend/app/services/lesson_layer_loaders.py"


def test_the_derivation_still_computes_something():
    """正向對照：它自己是好的 —— 否則下面那條「沒人用」講的是另一件事。"""
    from app.services.lesson_layer_loaders import _derive_docx_url, _DOCX_CODES
    assert len(_DOCX_CODES) > 100, f"manifest 只讀到 {len(_DOCX_CODES)} 個 code"
    sample = sorted(_DOCX_CODES)[0]
    assert _derive_docx_url(sample), f"{sample} 算不出 URL"
    assert _derive_docx_url("NOPE-L99") is None, "不在 manifest 裡的不該回 URL"


def test_the_unwired_state_is_written_down_where_someone_will_see_it():
    """⛔ 「算得出來但沒人用」不可以只存在於某個人的記憶裡。

    docstring 說 callers 會呼叫它 —— 實際上沒有。那句話留著會誤導下一個人，
    所以它旁邊必須寫明現況與原因。
    """
    src = LOADERS.read_text(encoding="utf-8")
    i = src.index("def _derive_docx_url")
    doc = src[i:i + 1800]
    assert "#2845" in doc, (
        "_derive_docx_url 的說明沒有指向 #2845 —— "
        "它的 docstring 宣稱 callers 會用它，但 routes/stories.py 並沒有")


def test_if_someone_wires_it_they_must_say_the_files_exist():
    """接上去的那天要一起改這條 —— 而不是接上去讓 139 課長出壞掉的按鈕。

    現在 `/assets/worksheets/*.docx` 一律 404（proxy 本身是好的，
    同一條路拿縮圖回 200）。檔案上傳前接上 = 學生按了就失敗。
    """
    src = STORIES.read_text(encoding="utf-8")
    wired = "_derive_docx_url" in src
    assert not wired, (
        "有人把 _derive_docx_url 接進 routes/stories.py 了 —— "
        "接之前請先確認 /assets/worksheets/*.docx 真的拿得到（2026-08-31 是 404），"
        "然後把這條鎖改成驗『接上了而且檔案在』，不要只是把它刪掉")
