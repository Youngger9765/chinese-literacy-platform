"""#2751 — 一個已經死掉的來源必須講得出自己死了。

Layer-2 的來源目錄在一修（#2683）就被封存刪除，`load_layer2_lessons()` 與
`build_layer2_enrichment_index()` 從此永遠回空。

問題不是「回空」，是**回空跟「真的一筆內容都沒有」長得一模一樣**。#2751 記著
一次實際誤判：某個內容儀表板顯示 0/175，讀起來像整批內容不見了，實際上只是
來源目錄早就不在。一個講不出自己已死的來源，會把每一個下游數字都變成假警報。

這裡鎖的不是「它回空」（那是預期），是**分得出來**。
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import lesson_layer_loaders as L


def test_the_flag_matches_reality():
    """旗標必須是量出來的，不是寫死的 —— 寫死的旗標下次來源回來時會說謊。"""
    assert L.LAYER2_SOURCE_AVAILABLE == L._PARSED_DIR.exists()


def test_empty_result_can_be_told_apart_from_a_dead_source():
    """核心：拿到空的時候，呼叫端要有辦法知道是「沒內容」還是「來源不在」。"""
    index = L.build_layer2_enrichment_index()
    if not L.LAYER2_SOURCE_AVAILABLE:
        # 來源不在 → 空是必然，而且旗標說得出來
        assert index == {}, "來源不存在卻拿到資料，那 _PARSED_DIR 指錯地方了"
    # 反過來不成立地斷言：來源在的時候不強制要有資料（可能真的是空目錄），
    # 但「空」這件事本身不可以是唯一的訊號 —— 旗標必須存在且是 bool。
    assert isinstance(L.LAYER2_SOURCE_AVAILABLE, bool)


def test_it_says_so_out_loud(caplog):
    """模組載入時要留下一行，不然只有讀 code 的人知道。

    重新載入模組來觸發 module-level 的那行 warning —— 直接 import 已經被
    其他測試載過了，caplog 抓不到。
    """
    import importlib

    with caplog.at_level("WARNING"):
        importlib.reload(L)

    if not L.LAYER2_SOURCE_AVAILABLE:
        said = [r for r in caplog.records if "Layer-2" in r.getMessage()]
        assert said, "來源不存在卻一聲不吭 —— 那就是 #2751 那個假警報的來源"
        msg = said[0].getMessage()
        # 訊息要說「這是預期」，不然看到 WARNING 的人會以為出事了
        assert "不是內容缺失" in msg, msg
    else:
        # 正向對照：來源真的存在時，不可以亂喊
        assert not [r for r in caplog.records if "Layer-2 來源不存在" in r.getMessage()]
