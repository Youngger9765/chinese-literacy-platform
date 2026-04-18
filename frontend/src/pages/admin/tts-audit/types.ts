// types.ts — shared types for TTS audit UI (Issue #1120)

export interface Replacement {
  from: string;
  to: string;
  rule: string;
}

export interface ProvenanceEntry {
  audit_id: string;
  generated_at: string;
  raw_text: string;
  tts_input: string;
  source_paragraph: string;
  replacements_applied: Replacement[];
  cache_key: string;
  gcs_uri: string;
  audio_sha256: string;
  audio_bytes: number;
  audio_duration_ms: number;
  provider: string;
  model: string;
  voice: string;
  language_code: string;
  location: string;
  lesson_id: number;
  paragraph_idx: number;
  sentence_idx: number;
  lesson_yaml_sha: string;
  batch_run_id: string;
  script_git_sha: string;
  generated_by: string;
  environment: string;
  generation_latency_ms: number;
  attempt_number: number;
  supersedes: string | null;
  // new fields from feat/tts-prompt-prefix (may be absent in older entries)
  tts_prompt_prefix?: string | null;
  tts_contents_sent?: string | null;
}

export type DisplayFilter = 'all' | 'replaced' | 'numbers' | 'taiwan';
