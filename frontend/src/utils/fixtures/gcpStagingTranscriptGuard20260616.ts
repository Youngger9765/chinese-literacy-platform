/**
 * Staging incident fixture — user session, lineIndex 1, ~2026-06-16.
 *
 * GCP (lingoleap-backend-staging):
 * - reading_transcribe_success transcript_len ≈ 193
 * - reading_eval_request spoken_len ≈ 105 (after bad conservative clamp)
 * - duration_ms 41317, audio_bytes 665995
 *
 * Bug: pickConservativeTranscript treated garbled short Web Speech as proof the
 * student stopped reading, discarding correct Gemini audio transcript.
 */
export const GCP_STAGING_TRANSCRIPT_GUARD_20260616 = {
  durationMs: 41_317,
  lineIndex: 1,
  targetText:
    '公元前299年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。孟嘗君便高高興興的和一批食客一起去秦國赴任。天有不測風雲，誰知道到了秦國，還沒有登上相位，就有人看他不順眼，開始對秦昭王咬耳根：「他是齊國人，做決策時一定先想齊國的好處，而後才考慮秦國，這樣可危險了。」秦昭王多疑狠毒，這些讒言讓他心裡的懷疑、猜忌一起發作，他不但開除了孟嘗君，還動了殺心，心想：「這人我不用，也不能給別人用。」便把他軟禁起來。',
  geminiAudioTranscript:
    '公元前299年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。孟嘗君便高高興興的和一批食客一起去秦國赴任。天有不測風雲，誰知道到了秦國，還沒有登上相位，就有人看他不順眼，咬耳朵對秦昭王，他是齊國人，做決策時一定先想齊國的好處，才考慮秦國，這樣就危險了。秦昭王多疑狠毒，這些讒言讓他心裡的猜忌懷疑一起發作，他不但開除了孟嘗君，還動了殺心，心想這人我不用，也不能給別人用，便把他軟禁了起來。',
  garbledWebSpeech:
    '公元前299年秦昭王金說孟嘗君的賢達變邀請他到秦國當宅相片高高興興的和ep10可以一起去秦國富任天有不測風雲誰知道告了秦國還沒有登上香味有人看他不順眼咬耳朵對請找往他是許多人做決策是一定心想起過的好處才考慮清楚',
} as const;
