"""本機沒有 Azure key 時，不可以把 fallback 的中國腔寫進正式共用快取。

2026-08-19 我做出來了：起本機 server 給 Young 驗證，本機沒有
`AZURE_SPEECH_KEY`，而 `TTS_GCS_BUCKET` 預設就指向正式那顆
`lingoleap-tts-cache`。於是每一次朗讀：

    Azure 失敗（沒 key）→ 退回 Google cmn-CN-Chirp3-HD-Sulafat（中國腔）
    → 寫進 gs://lingoleap-tts-cache/tts-cache/

CLAUDE.md 早就記著這個地雷：azure prefix miss 時讀取路徑會回讀
`tts-cache/`，所以一次短暫失敗就把該句**永久**釘在中國腔，Azure 恢復也救不回。
（2026-04 盲聽已否決中國腔。）

**這個預設值本身就是缺陷**：任何人 clone 下來起本機都會做同樣的事，
而且沒有任何警告 —— log 只會安靜地寫一行 `GCS cache write`。

所以改成 fail-closed：**產生這段音訊的 provider 不是設定的 primary 時，不寫共用快取。**
記憶體快取照舊（本機開發仍然順），但寫不到會影響別人的地方。
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.tts import cache as tts_cache  # noqa: E402


def test_fallback_audio_never_reaches_the_shared_cache(monkeypatch):
    """primary 是 azure、實際產出是 google ⇒ 不可以寫進共用快取。"""
    monkeypatch.setattr(tts_cache, "TTS_PRIMARY_PROVIDER", "azure", raising=False)
    written: list[str] = []

    class _Blob:
        def __init__(self, path): self.path = path
        def upload_from_string(self, *a, **k): written.append(self.path)
        def exists(self): return False

    class _Bucket:
        def blob(self, path): return _Blob(path)

    monkeypatch.setattr(tts_cache, "_get_gcs_bucket", lambda: _Bucket())
    tts_cache._gcs_put("deadbeef", b"x" * 100, provider="google")
    assert written == [], (
        f"fallback 的音訊被寫進共用快取：{written} —— "
        "一次短暫失敗就會把那句永久釘在中國腔"
    )


def test_the_primary_provider_still_writes(monkeypatch):
    """正向對照：primary 自己產出的照舊要寫，不然快取整個失效。"""
    monkeypatch.setattr(tts_cache, "TTS_PRIMARY_PROVIDER", "azure", raising=False)
    written: list[str] = []

    class _Blob:
        def __init__(self, path): self.path = path
        def upload_from_string(self, *a, **k): written.append(self.path)
        def exists(self): return False

    class _Bucket:
        def blob(self, path): return _Blob(path)

    monkeypatch.setattr(tts_cache, "_get_gcs_bucket", lambda: _Bucket())
    tts_cache._gcs_put("deadbeef", b"x" * 100, provider="azure")
    assert len(written) == 1, f"primary 的音訊沒寫進快取：{written}"


def test_the_default_matches_the_service_so_local_is_covered():
    """預設值必須跟服務層一樣是 `azure`。

    ⚠️ 這條是對第一版的修正。我原本把預設寫成空字串，於是「沒設 `TTS_PROVIDER`」
    會落回舊行為 —— 而那**正是** 2026-08-19 出事的情況（本機沒設，中國腔照樣寫進
    正式快取）。一個防線如果剛好避開它要防的那個場景，等於沒有。
    """
    from app.services import tts as tts_service

    assert tts_cache.TTS_PRIMARY_PROVIDER == tts_service.TTS_PROVIDER.strip().lower(), (
        f"cache 認為 primary 是 {tts_cache.TTS_PRIMARY_PROVIDER!r}，"
        f"服務層卻用 {tts_service.TTS_PROVIDER!r} —— 兩邊不一致就會有一個環境沒被守到"
    )


def test_explicitly_unset_primary_behaves_as_before(monkeypatch):
    """真的把 primary 設成空（例如刻意關掉這道防線）時維持舊行為。"""
    monkeypatch.setattr(tts_cache, "TTS_PRIMARY_PROVIDER", "", raising=False)
    written: list[str] = []

    class _Blob:
        def __init__(self, path): self.path = path
        def upload_from_string(self, *a, **k): written.append(self.path)
        def exists(self): return False

    class _Bucket:
        def blob(self, path): return _Blob(path)

    monkeypatch.setattr(tts_cache, "_get_gcs_bucket", lambda: _Bucket())
    tts_cache._gcs_put("deadbeef", b"x" * 100, provider="google")
    assert len(written) == 1
