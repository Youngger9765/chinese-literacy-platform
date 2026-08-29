"""改發音修正表 = 全庫朗讀音檔瞬間不可達。這件事必須擋得住，不能靜默發生。

`_cache_key` 把發音修正表的指紋放進 key（`normalization.py:339`）：

    sha256(f"{CORRECTIONS_FINGERPRINT}\\0{text.strip()}")

**這個設計是對的** —— 改了發音卻繼續放舊音檔變成不可能：舊 blob 變「不可達」，
而不是「繼續錯」。代價寫在 docstring 裡：重生全庫約 $2。

問題是**沒有任何東西會執行、提醒或檢查那次重生**。改一行修正 →
下次部署後全庫音檔全部不可達 → 每個學生按播放都退回現場合成 →
而 CI 綠、部署成功、沒有告警（#2742）。

實測（2026-08-20，加一條完全無關的修正條目）：

    指紋      cda4399d726e → 05dd81c1ad4c
    三句抽樣  key 3/3 全部改變

而當時 staging 剛預熱完 6574 句、跑了 6.5 小時，延遲從 1900ms 降到 254ms ——
那一改就全部作廢。

## 這條 spec 做什麼

把「快取是用哪個指紋熱的」記在檔案裡，和現在的指紋比對。
改了修正表 → 這條紅 → 你會在 CI 上看到，而不是等學生等 8 秒。

⛔ 它**不會**自動重生（要花錢、要跑數小時，那是人的決定）。
它只保證那個決定**不會被忘記**。

## 給下一個要驗這條鎖的人

Mutation 要改的是 `PHONEME_CORRECTIONS: list[tuple[str, str]] = [` 後面第一行。
⚠️ 用 `s.index('PHONEME_CORRECTIONS')` 再找下一個 `[` 會插進**型別註解**
`list[tuple[...]]` 裡 —— 檔案確實變了、`diff | grep -c` 也 > 0，但指紋不動、測試照樣綠，
於是你會以為這條鎖是廢的。

**證明改到檔案還不夠，要證明改到「你要改的那個東西」** ——
這裡的判準是印出 `CORRECTIONS_FINGERPRINT` 看它真的移動了（202→203 條目時
cda4399d726e → 05dd81c1ad4c），再看測試紅。
"""
from __future__ import annotations

import pathlib

import pytest

from app.services.tts.normalization import CORRECTIONS_FINGERPRINT

RECORD = (
    pathlib.Path(__file__).resolve().parents[1]
    / "data" / "tts_cache_fingerprint.txt"
)


def _recorded() -> str:
    if not RECORD.is_file():
        pytest.fail(
            f"找不到 {RECORD.name} —— 這個檔記錄「線上快取是用哪個指紋熱的」。\n"
            f"第一次建立：把現在的指紋寫進去（{CORRECTIONS_FINGERPRINT}），"
            f"並確認那批音檔確實是用它產生的。"
        )
    return RECORD.read_text(encoding="utf-8").strip().splitlines()[0].strip()


def test_the_pronunciation_table_has_not_moved_since_the_cache_was_warmed():
    recorded = _recorded()
    assert recorded == CORRECTIONS_FINGERPRINT, (
        "發音修正表變了，線上每一個朗讀音檔的 cache key 都跟著變 ——\n"
        f"  快取熱的時候是  {recorded}\n"
        f"  現在的表算出來是 {CORRECTIONS_FINGERPRINT}\n"
        "\n"
        "所有已快取的音檔現在都**不可達**（不是壞掉，是永遠不會被命中）。\n"
        "學生每按一次播放都會現場合成：實測 8–24 秒，偶發 503。\n"
        "\n"
        "要做的兩件事，缺一不可：\n"
        "  1. 重新預熱  python scripts/prewarm_tts_cache.py --base <有 Azure key 的環境>\n"
        f"  2. 把新指紋寫進 backend/data/tts_cache_fingerprint.txt：{CORRECTIONS_FINGERPRINT}\n"
        "\n"
        "⛔ 不要只改第 2 步讓這條變綠 —— 那就是把警報消音，"
        "學生照樣每次等 8 秒，而且沒有人會再發現。"
    )


def test_the_recorded_fingerprint_looks_like_a_fingerprint():
    """正向對照：檔案有內容、格式對。

    少了這條，把檔案清空或寫進垃圾也會讓上面那條「通過」——
    那種綠只代表沒人在看。
    """
    recorded = _recorded()
    assert len(recorded) == 12, f"指紋應該是 12 個十六進位字元，拿到 {recorded!r}"
    assert all(c in "0123456789abcdef" for c in recorded), recorded


def test_the_fingerprint_actually_tracks_the_table():
    """這條鎖的是「指紋真的會跟著表動」。

    如果哪天有人把 `_compute_corrections_fingerprint` 改成回傳常數，
    上面兩條會永遠綠，而整個保護就沒了 —— 那是最難察覺的失效方式。
    """
    import hashlib

    from app.services.tts.normalization import PHONEME_CORRECTIONS

    nul, soh = chr(0), chr(1)

    def fp(table) -> str:
        body = nul.join(f"{k}{soh}{v}" for k, v in sorted(table))
        return hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]

    assert fp(PHONEME_CORRECTIONS) == CORRECTIONS_FINGERPRINT, (
        "指紋跟修正表的內容對不起來 —— 它可能已經不是在追蹤那張表了"
    )
    moved = fp(list(PHONEME_CORRECTIONS) + [("測試詞", "ㄘㄜˋ ㄕˋ ㄘˊ")])
    assert moved != CORRECTIONS_FINGERPRINT, (
        "多一條修正條目卻算出同一個指紋 —— 那這個保護等於不存在"
    )
