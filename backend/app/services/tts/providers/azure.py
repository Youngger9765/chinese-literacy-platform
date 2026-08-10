from __future__ import annotations

import os
import time
import logging
import urllib.error
import urllib.request

from .. import TTSError
from ..normalization import _apply_phoneme_corrections

logger = logging.getLogger(__name__)

# One retry covers the observed ~1-in-10 truncated transfer; more would
# only add latency to a genuine outage, which the caller handles.
AZURE_MAX_ATTEMPTS = 3
AZURE_RETRY_BACKOFF_S = 0.5

AZURE_SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION", "eastus")
AZURE_TTS_VOICE = os.environ.get("AZURE_TTS_VOICE", "zh-TW-HsiaoChenNeural")


def _synthesize_azure(text: str) -> bytes:
    if not AZURE_SPEECH_KEY:
        raise TTSError("AZURE_SPEECH_KEY is not set")

    url = f"https://{AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"

    text_escaped = (
        text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )
    ssml_body = _apply_phoneme_corrections(text_escaped)

    # #2082 A1: brisker pace ~260-270 字/分 (product-tunable; was 0.95)
    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW">'
        f'<voice name="{AZURE_TTS_VOICE}">'
        f'<prosody rate="1.08">{ssml_body}</prosody>'
        "</voice>"
        "</speak>"
    )

    req = urllib.request.Request(
        url,
        data=ssml.encode("utf-8"),
        headers={
            "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-48khz-192kbitrate-mono-mp3",
        },
    )

    # Retry a dropped connection; do not retry a refusal.
    #
    # Measured: the same paragraph, 10 consecutive calls, failed once — always
    # `IncompleteRead`, the response starting to arrive and the connection
    # closing mid-stream. Azure refused nothing; the transfer broke.
    #
    # That used to raise, and synthesize_speech would fall through to Google —
    # cmn-CN-Chirp3-HD, the mainland accent rejected in 2026-04, which also
    # skips the pause shortening. So about one paragraph in ten came out in the
    # wrong accent with the long pauses left in, and since the cache key does
    # not record the provider, once written it kept being served.
    #
    # HTTPError is deliberately not retried: a 400 means the SSML is wrong and
    # sending it again produces the same 400, so retrying only multiplies the
    # latency of a genuine mistake.
    audio_bytes = b""
    last_exc: Exception | None = None
    for attempt in range(AZURE_MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                audio_bytes = resp.read()
            break
        except urllib.error.HTTPError as exc:
            raise TTSError(f"Azure TTS HTTP error {exc.code}: {exc.reason}") from exc
        except Exception as exc:
            last_exc = exc
            if attempt + 1 < AZURE_MAX_ATTEMPTS:
                logger.warning(
                    "Azure TTS transfer failed (attempt %d/%d), retrying: %s",
                    attempt + 1, AZURE_MAX_ATTEMPTS, exc,
                )
                time.sleep(AZURE_RETRY_BACKOFF_S * (attempt + 1))
    else:
        raise TTSError(f"Azure TTS request failed: {last_exc}") from last_exc

    if not audio_bytes:
        raise TTSError("Azure TTS returned empty audio content")

    return audio_bytes
