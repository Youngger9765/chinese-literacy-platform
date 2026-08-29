"""預熱必須熱「播放器真的會要的那個字串」。

2026-08-20：第一版自己 `re.split(r"[。！？；]")` 切句、切完 `strip()` 丟掉標點，
播放器送的卻是保留標點的字串。快取鍵是 `sha256(raw_text.strip())`，
差一個標點就是不同的 key —— 跑了 236 分鐘、成功 5174 句，播放器一句都要不到。

所以這裡鎖的不是「有沒有切句」，是「**列舉出來的字串跟消費者要的一模一樣**」。
"""
from __future__ import annotations

import importlib.util
import io
import json
import pathlib
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "prewarm_tts_cache.py"


def _load():
    spec = importlib.util.spec_from_file_location("prewarm", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# 這份是 /api/tts/mapping/{id} 的真實形狀（取自 staging 課 20011），
# 標點刻意留著 —— 那正是播放器會拿去 hash 的字串。
MAPPING = {
    "paragraphs": [
        {
            "index": 0,
            "sentences": [
                {"text": "「戴資穎戴資穎第一名，戴資穎戴資穎我愛妳」這一句洗腦的廣告臺詞，"},
                {"text": "是否也在你的周遭出現？"},
            ],
        },
        {
            "index": 1,
            "sentences": [
                {"text": "她就是臺灣第一人，累計214周排名世界第一的球后，戴資穎。"},
            ],
        },
    ]
}


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _fake_urlopen(payload):
    def _open(url, timeout=None):
        return _Resp(json.dumps(payload).encode())
    return _open


def test_enumerated_sentences_keep_the_punctuation_the_player_sends():
    mod = _load()
    with patch.object(mod.urllib.request, "urlopen", _fake_urlopen(MAPPING)):
        got = mod.sentences_of("https://example.invalid", 20011)

    expected = [
        s["text"] for p in MAPPING["paragraphs"] for s in p["sentences"]
    ]
    assert got == expected, (
        "列舉出來的字串必須跟 mapping 回的逐字相同。"
        "少一個標點就是另一個 sha256，熱了也是白熱。"
    )
    # 逐條講明白：結尾標點不可以被吃掉
    assert got[0].endswith("，")
    assert got[1].endswith("？")
    assert got[2].endswith("。")


def test_every_sentence_is_nonempty_and_deduped():
    mod = _load()
    dupes = {
        "paragraphs": [
            {"index": 0, "sentences": [{"text": "一樣的句子。"}, {"text": "一樣的句子。"}, {"text": "  "}]},
        ]
    }
    with patch.object(mod.urllib.request, "urlopen", _fake_urlopen(dupes)):
        got = mod.sentences_of("https://example.invalid", 1)
    assert got == ["一樣的句子。"]


def test_lesson_ids_refuses_a_truncated_page():
    """分頁靜默截斷過一次（page_size 預設 60），拿殘缺清單去跑等於少熱一大半。"""
    mod = _load()
    truncated = {"total": 175, "stories": [{"id": i} for i in range(60)]}
    with patch.object(mod.urllib.request, "urlopen", _fake_urlopen(truncated)):
        try:
            mod.lesson_ids("https://example.invalid")
        except SystemExit as e:
            assert "60/175" in str(e)
        else:
            raise AssertionError("拿到 60/175 還繼續跑 —— 應該要中止")
