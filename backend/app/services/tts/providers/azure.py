from __future__ import annotations

import os
import urllib.error
import urllib.request

from .. import TTSError
from ..normalization import _apply_phoneme_corrections, escape_for_ssml

AZURE_SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION", "eastus")
AZURE_TTS_VOICE = os.environ.get("AZURE_TTS_VOICE", "zh-TW-HsiaoChenNeural")


def _synthesize_azure(text: str) -> bytes:
    if not AZURE_SPEECH_KEY:
        raise TTSError("AZURE_SPEECH_KEY is not set")

    url = f"https://{AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"

    text_escaped = escape_for_ssml(text)
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

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            audio_bytes = resp.read()
    except urllib.error.HTTPError as exc:
        raise TTSError(f"Azure TTS HTTP error {exc.code}: {exc.reason}") from exc
    except Exception as exc:
        raise TTSError(f"Azure TTS request failed: {exc}") from exc

    if not audio_bytes:
        raise TTSError("Azure TTS returned empty audio content")

    return audio_bytes
