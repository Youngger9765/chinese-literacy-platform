"""大題序號必須是漢字，不能是長得一樣的注音（#2843）。

## 這條是 overview skill 第一次真的跑起來抓到的

2026-08-22 拿 L0153（文-L10 荒野救亡記）當測試：只讀 PDF、不看
`sections_present`，判出 9 個大題 —— 名稱 9/9 全中，唯一差異是第一個序號。

我讀成漢字「一」(U+4E00)，資料裡是注音「ㄧ」(U+3127)。兩者在畫面上幾乎無法分辨。

⚠️ 我第一個判斷是「既有資料的錯字」，**查原稿才知道錯的是原稿** ——
DOCX 裡就是注音 ㄧ，老師打的。抽取器忠實抄了下來。

## 所以逐字欄位與序號欄位分開處理

| 欄位 | 怎麼處理 | 為什麼 |
|---|---|---|
| `label`（如「ㄧ、文白句子比對」） | **保留注音** | 逐字抄自學習單，忠實優先 |
| `no` / `section_no` | **正規化成漢字** | 那是給機器排序、對帳、顯示用的序號 |

⛔ 不要「統一」成同一種處理 —— 逐字欄位被正規化就失去逐字的意義，
序號欄位不正規化就會出現 `'ㄧ' != '一'` 這種永遠比不對的坑。
"""
from __future__ import annotations

import pathlib

import pytest
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"

#: 注音符號裡長得像漢字數字的那幾個。目前只實際出現過 ㄧ。
BOPOMOFO_LOOKALIKES = {"ㄧ": "一"}


#: `_extracted/` 是抽取器的**原始輸出**，跟 `label` 同一個道理：它記錄「原稿長什麼樣」。
#: 正規化發生在切成 v3 模組檔的時候，不是在原始輸出上。
#: 少了這個排除，門會逼人去改原始輸出 —— 那就把原稿資訊弄丟了。
RAW_DIRS = {"_extracted"}


def _offenders() -> list[tuple[str, str, str]]:
    out = []
    for path in sorted(LESSONS.rglob("*.yml")):
        if RAW_DIRS & set(path.relative_to(LESSONS).parts):
            continue
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        rel = str(path.relative_to(LESSONS))
        for bad in BOPOMOFO_LOOKALIKES:
            if bad in str(data.get("section_no") or ""):
                out.append((rel, "section_no", data["section_no"]))
            for row in data.get("sections_present") or []:
                if isinstance(row, dict) and bad in str(row.get("no") or ""):
                    out.append((rel, "sections_present.no", row["no"]))
            for row in data.get("sections") or []:
                if isinstance(row, dict) and bad in str(row.get("no") or ""):
                    out.append((rel, "_manifest.sections.no", row["no"]))
    return out


def test_the_scan_read_files(  ):
    """掃描前提 —— 讀不到檔時下面會恆綠。"""
    assert len(list(LESSONS.rglob("*.yml"))) > 1500


def test_section_numbers_use_hanzi_not_bopomofo():
    bad = _offenders()
    assert not bad, (
        "序號欄位出現注音符號（畫面上跟漢字幾乎分不出來，但比對永遠不相等）：\n"
        + "\n".join(f"  {f}  {k} = {v!r}" for f, k, v in bad[:12])
        + "\n\n⚠️ 只正規化序號欄位。`label` 之類的逐字欄位**保留原稿的字** ——"
          "\n   原稿（DOCX）本身就打注音的情形確實存在（L0153 就是），那不是抽取錯。"
    )


def test_verbatim_labels_are_not_normalised():
    """反向：逐字欄位若被「順手修好」，這條要紅。

    少了它，下一個人看到 label 裡的注音會以為是漏改，一起正規化掉，
    那就把「原稿長什麼樣」這個資訊弄丟了。
    """
    found = 0
    for path in LESSONS.rglob("*.yml"):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        for value in data.values():
            if isinstance(value, dict) and "ㄧ" in str(value.get("label") or ""):
                found += 1
    # ⚠️ 用**數量**斷言，不是 `>= 1`。
    # 第一版寫 `>= 1`，mutation 時改掉一課它照樣綠 —— 還有別課撐著。
    # 「至少有一個是對的」不是覆蓋率，這一天已經踩過同型的坑。
    EXPECTED = 4   # 2026-08-22 實測（用本測試自己的算法取，不是另外數檔案）
    assert found == EXPECTED, (
        f"逐字 label 保留注音的檔數從 {EXPECTED} 變成 {found}。\n"
        "變少 = 有人把逐字欄位「順手修好」了，那會弄丟「原稿長什麼樣」這個資訊 ——\n"
        "  L0153 等課的原稿 DOCX 本身就是注音 ㄧ，抽取器沒抄錯。\n"
        "變多 = 新的課也有這個情形，確認過就更新這個基準。"
    )
