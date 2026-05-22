import { API_BASE } from '../apiConfig';
import { authToken } from '../../utils/storage';

// ---------------------------------------------------------------------------
// Dictionary lookup (Issue #259)
// ---------------------------------------------------------------------------

export interface DictionaryDefinition {
  type: string;
  definition: string;
  examples: string[];
}

export interface DictionaryEntry {
  character: string;
  zhuyin: string | null;
  stroke_count: number | null;
  definitions: DictionaryDefinition[];
  cached: boolean;
  not_found: boolean;
  error?: string;
}

export interface DictionaryBatchResponse {
  results: DictionaryEntry[];
}

function _getDictAuthHeaders(): Record<string, string> {
  return authToken.authHeader();
}

/** Look up a single Chinese character from the MOE dictionary (cached). Requires auth. */
export async function lookupCharacter(character: string): Promise<DictionaryEntry> {
  const res = await fetch(
    `${API_BASE}/api/dictionary/character/${encodeURIComponent(character)}`,
    { headers: _getDictAuthHeaders() },
  );
  if (!res.ok) throw new Error(`lookupCharacter failed: ${res.status}`);
  return res.json();
}

/** Batch look up multiple Chinese characters via GET ?chars= (max 20). Requires auth. */
export async function lookupCharactersQuery(chars: string): Promise<DictionaryBatchResponse> {
  const url = `${API_BASE}/api/dictionary/lookup?chars=${encodeURIComponent(chars)}`;
  const res = await fetch(url, { headers: _getDictAuthHeaders() });
  if (!res.ok) throw new Error(`lookupCharactersQuery failed: ${res.status}`);
  return res.json();
}

/** Batch look up multiple Chinese characters (max 20, deduplication applied). Requires auth. */
export async function lookupCharactersBatch(characters: string[]): Promise<DictionaryBatchResponse> {
  const res = await fetch(`${API_BASE}/api/dictionary/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._getDictAuthHeaders() },
    body: JSON.stringify({ characters }),
  });
  if (!res.ok) throw new Error(`lookupCharactersBatch failed: ${res.status}`);
  return res.json();
}
