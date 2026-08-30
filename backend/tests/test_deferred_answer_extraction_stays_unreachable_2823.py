"""`extract_single_options` 那三段 regex 帶著 #2735 已修的同一個錯誤假設
（「沒被框到的字 = 答案」），但它只在 `_needs_answer_extraction=True` 時才跑，
而那個旗標在現行 175 份教材語料庫上**一次都沒被設過**。

#2823 的決定是「不修」——沒有真實案例可以驗證修得對不對，
而 #2735 其他六處每一處都是對著真語料行為驗過的，不是猜的。

⛔ 但「不修」不等於「不看著」。這支就是那條絆線：
   它變可達的那天，這裡要紅，而不是靜靜地開始用一個壞掉的假設猜答案。

絆線守的是「什麼形狀會走到那個 fallback」。真語料裡的題型（#2735 量過的那些）
一律要在前面就拿到 options 或 answer；只有什麼都抽不到時才落到 fallback。
"""
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))


@pytest.fixture(scope="module")
def classify():
    from build_lesson_schema import _classify_question_para
    return _classify_question_para


#: 真語料裡實際出現過的形狀（來自 #2735 的量測），一律不該落到 fallback
REAL_SHAPES = [
    ("這種說法叫做□①甲　□②乙", [1]),
    ("下列何者正確？□①春天　□②夏天　□③秋天", [0]),
    ("❶作者的用意是什麼？□①說明　□②抒情", [0]),
]


@pytest.mark.parametrize("txt,checked", REAL_SHAPES)
def test_real_corpus_shapes_never_reach_the_deferred_path(classify, txt, checked):
    """語料裡真的有的形狀，都要在前面就抽到東西。"""
    r = classify(txt, "unknown", checked=checked)
    assert not r.get("_needs_answer_extraction"), (
        f"這個形狀落到 #2823 的 fallback 了：{txt!r}\n"
        "→ `extract_single_options` 會用『沒框=答案』去猜，而 #2555 之後那個訊號已失真。\n"
        "→ 現在有真實案例了，#2823 可以（而且應該）修了。")
    assert r.get("options") or r.get("answer"), "抽不到任何東西 = 下一步就是 fallback"


def test_the_tripwire_can_actually_fire(classify):
    """⭐ 正向對照：真的有輸入會設那個旗標，否則上面三條只是恆真。

    什麼都抽不到的單選段落 —— 沒有框、沒有選項標記。
    """
    r = classify("□", "unknown", checked=[])
    assert r.get("_needs_answer_extraction") is True, (
        "連這種什麼都沒有的輸入都不會設旗標 —— 那上面那三條斷言什麼都沒證明，"
        "可能是 fallback 分支整個被改掉了（那 #2823 要重寫，不是關掉）")


def test_the_deferred_function_still_carries_its_warning(classify):
    """#2823 的理由寫在 code 裡。理由被刪掉 = 下一個人不知道那三段 regex 有問題。"""
    src = (REPO / "scripts" / "build_lesson_schema.py").read_text(encoding="utf-8")
    i = src.index("def extract_single_options")
    doc = src[i:i + 2500]
    assert "#2823" in doc, "extract_single_options 的 docstring 不再指向 #2823"
    assert "_needs_answer_extraction" in doc, "沒說清楚它只在什麼條件下會跑"
