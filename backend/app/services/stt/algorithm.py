"""
Core STT correction and scoring algorithms.

- correct_homophones: Levenshtein-aligned homophone correction.
- compute_match_rate: character-frequency match scoring.

Ported from frontend/src/utils/pinyin.ts.
"""

from .pinyin import is_homophone
from .normalization import normalize_for_comparison


def correct_homophones(stt_text: str, target_text: str) -> str:
    """
    Given raw STT text and the known target text, correct homophone substitutions
    on a character-by-character basis using Levenshtein alignment with backtracking.

    For each aligned pair (stt_char, target_char):
      - Same character → keep as-is.
      - Homophones → replace STT char with target char.
      - Not homophones → keep STT char (genuine error).

    Returns the corrected string.
    Ported from frontend/src/utils/pinyin.ts correctHomophones().
    """
    s = list(stt_text)
    t = list(target_text)
    s_len, t_len = len(s), len(t)

    if s_len == 0 or t_len == 0:
        return stt_text

    # Build DP table (Levenshtein distance)
    dp = [[0] * (t_len + 1) for _ in range(s_len + 1)]
    for i in range(s_len + 1):
        dp[i][0] = i
    for j in range(t_len + 1):
        dp[0][j] = j

    for i in range(1, s_len + 1):
        for j in range(1, t_len + 1):
            cost = 0 if s[i - 1] == t[j - 1] else 1
            dp[i][j] = min(
                dp[i - 1][j] + 1,        # deletion
                dp[i][j - 1] + 1,        # insertion
                dp[i - 1][j - 1] + cost, # substitution
            )

    # Backtrack to find alignment
    result: list[str] = []
    i, j = s_len, t_len

    while i > 0 or j > 0:
        if i > 0 and j > 0:
            cost = 0 if s[i - 1] == t[j - 1] else 1
            if dp[i][j] == dp[i - 1][j - 1] + cost:
                # Match or substitution
                if s[i - 1] == t[j - 1]:
                    result.append(s[i - 1])          # exact match
                elif is_homophone(s[i - 1], t[j - 1]):
                    result.append(t[j - 1])           # homophone → use target
                else:
                    result.append(s[i - 1])           # genuine mismatch → keep STT
                i -= 1
                j -= 1
                continue
        if i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            result.append(s[i - 1])  # deletion (extra char in STT) — keep
            i -= 1
        else:
            j -= 1                   # insertion (missing from STT) — skip

    result.reverse()
    return "".join(result)


def compute_match_rate(corrected: str, target: str) -> float:
    """
    Character-frequency overlap between corrected STT and target text.
    Both strings are first normalised (punctuation removed, numbers converted).
    Returns a float in [0, 1].
    """
    spoken_norm = normalize_for_comparison(corrected)
    target_norm = normalize_for_comparison(target)

    if not target_norm or not spoken_norm:
        return 0.0

    spoken_freq: dict[str, int] = {}
    for ch in spoken_norm:
        spoken_freq[ch] = spoken_freq.get(ch, 0) + 1

    matched = 0
    for ch in target_norm:
        if spoken_freq.get(ch, 0) > 0:
            matched += 1
            spoken_freq[ch] -= 1

    return matched / len(target_norm)
