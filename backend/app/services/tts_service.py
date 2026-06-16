"""Compatibility shim for existing TTS imports."""

# Gemini TTS GenerateContentConfig lives in tts/providers/gemini.py (AUDIO-only; no thinking_config).
import sys

from . import tts as _tts
from .tts import (  # noqa: F401
    AZURE_SPEECH_KEY,
    AZURE_SPEECH_REGION,
    AZURE_TTS_VOICE,
    CACHE_MAX_ENTRIES,
    GCP_PROJECT,
    GEMINI_TTS_MODEL,
    GEMINI_TTS_PROMPT_PREFIX,
    GEMINI_TTS_VOICE,
    MAX_SENTENCE_LEN,
    PHONEME_CORRECTIONS,
    TTS_GCS_BUCKET,
    TTS_LANGUAGE_CODE,
    TTS_PROVIDER,
    TTS_VOICE,
    TTSError,
    _GCS_UNAVAILABLE,
    _PHONEME_CORRECTIONS,
    _SENTENCES_V2_CACHE,
    _SENTENCES_V2_PATH,
    _TTS_CACHE,
    _apply_phoneme_corrections,
    _cache_key,
    _clean_for_tts,
    _gcs_client,
    _gcs_get,
    _gcs_put,
    _get_gcs_bucket,
    _get_tts_client,
    _has_phoneme_corrections,
    _l1_put,
    _load_sentences_v2,
    _numbers_to_chinese_tw,
    _pcm_to_mp3,
    _split_sentences,
    _synthesize_azure,
    _synthesize_chunk,
    _synthesize_gemini,
    _synthesize_google,
    _tts_client,
    build_lesson_tts_mapping,
    delete_tts_cache,
    get_cached_tts,
    synthesize_sentence,
    synthesize_speech,
)

sys.modules[__name__] = _tts
