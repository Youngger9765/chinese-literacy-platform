"""朗讀評估端點的輸入要有長度上限（#3162）。

`ReadingEvaluateRequest` 的 `spoken_text` 與 `target_text` 原本**兩個都沒有**
`max_length`，而所有兄弟端點都有（正向對照寫在下面的測試裡）：

    learning_comprehension.py:32   story_text      10000
    learning_strategy.py:41-47     question 1000 / student_answer 500 /
                                   strategy_name 128 / story_title 200 /
                                   passage 4000

為什麼要緊：`target_text` 未消毒就直接進 LLM prompt（`spoken_text` 下游還會被
`input_sanitizer` 砍到 2000，`target_text` 不會），而 `main.py` 沒有 body-size
middleware。限流是 per-process 的記憶體字典而 prod `maxScale=3`，所以標
「10 次/分鐘」的實際上限是 30 —— 一個已登入帳號可以持續灌大 payload 進 Gemini。
那同時是花錢面與未消毒的注入面。
"""
import pytest
from pydantic import ValidationError

from app.routes.learning.learning_reading import ReadingEvaluateRequest

CAP = 10000


def test_normal_length_still_accepted():
    """正向對照：真實用量遠低於上限，不可擋到學生。

    全庫最長的重點朗讀段是 621 字，所以 10000 離真實用量很遠。
    """
    r = ReadingEvaluateRequest(spoken_text="床前明月光" * 20, target_text="疑是地上霜" * 20)
    assert len(r.target_text) == 100


def test_exactly_at_cap_accepted():
    r = ReadingEvaluateRequest(spoken_text="字" * CAP, target_text="文" * CAP)
    assert len(r.spoken_text) == CAP


@pytest.mark.parametrize("field", ["spoken_text", "target_text"])
def test_over_cap_rejected(field):
    """⭐ 超過上限要被擋。兩個欄位都要，不是只擋一個。"""
    payload = {"spoken_text": "字" * 10, "target_text": "文" * 10}
    payload[field] = "爆" * (CAP + 1)
    with pytest.raises(ValidationError) as e:
        ReadingEvaluateRequest(**payload)
    assert "at most" in str(e.value) or "max_length" in str(e.value)


def test_both_fields_have_a_cap_declared():
    """直接斷言 schema 上有上限，不只斷言某個長度會被擋。

    分開寫的理由：如果哪天有人把上限調到 10_000_000，上面那條 CAP+1 會失敗而
    看起來像「上限不見了」，但真正發生的事是「上限變得沒有意義」。這條讀 schema。
    """
    fields = ReadingEvaluateRequest.model_fields
    for name in ("spoken_text", "target_text"):
        meta = fields[name].metadata
        caps = [getattr(m, "max_length", None) for m in meta]
        caps = [c for c in caps if c is not None]
        assert caps, f"{name} 沒有宣告 max_length"
        assert caps[0] <= 20000, f"{name} 的上限 {caps[0]} 大到沒有意義"


def test_sibling_endpoints_still_have_their_caps():
    """正向對照：兄弟端點的上限還在。

    這條存在的理由是「這一支是唯一漏掉的」這個論述要站得住 —— 如果兄弟們其實
    也沒有上限，那我的修法方向就不是補齊而是另一回事。
    """
    from app.routes.learning.learning_comprehension import (  # noqa: PLC0415
        ComprehensionRequest as CompReq,
    )

    meta = CompReq.model_fields["story_text"].metadata
    caps = [getattr(m, "max_length", None) for m in meta]
    caps = [c for c in caps if c is not None]
    assert caps, "learning_comprehension 的 story_text 沒有上限 —— 那本文的前提就錯了"
