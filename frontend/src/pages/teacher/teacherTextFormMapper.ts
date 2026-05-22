/**
 * teacherTextFormMapper.ts — Pure utility functions for MyTextsTab form state.
 *
 * Extracted from MyTextsTab.tsx (Issue #1854) to enable isolated unit tests
 * and reuse across sub-components (MyTextFormModal, MyTextsList, etc.).
 *
 * All functions are pure (no side-effects, no React imports).
 */

import type {
  TeacherTextDetail,
  TeacherTextCreateRequest,
  VocabItem,
} from '../../services/teacherTextsApi';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VocabFormItem {
  word: string;
  definition: string;
  note: string;
}

export interface FormState {
  title: string;
  grade: number;
  genre: string;
  text_type: string;
  reading_strategy: string;
  paragraphs: string[];
  vocabulary: VocabFormItem[];
}

// ── Constants ────────────────────────────────────────────────────────────────

export const GENRES = ['記敘文', '說明文', '議論文', '文言文', '應用文'];
export const GRADES = [4, 5, 6, 7, 8, 9];
export const TEXT_TYPES: { value: string; label: string }[] = [
  { value: '單', label: '單篇文章' },
  { value: '多*2', label: '雙篇對比文本' },
  { value: '多*3', label: '三篇群文閱讀' },
];

// ── Helper: stable row IDs (prevent React reusing DOM nodes after deletion) ──

/**
 * Generates N stable row IDs for paragraph/vocab arrays.
 * Each ID is unique and starts with "r-" for easy identification.
 */
export function makeStableIds(count: number): string[] {
  return Array.from({ length: count }, () =>
    `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

// ── defaultForm ───────────────────────────────────────────────────────────────

/** Returns a blank FormState for the create form. */
export function defaultForm(): FormState {
  return {
    title: '',
    grade: 5,
    genre: '記敘文',
    text_type: '單',
    reading_strategy: '',
    paragraphs: [''],
    vocabulary: [],
  };
}

/** Empty vocab item for addVocabItem. */
export function emptyVocabItem(): VocabFormItem {
  return { word: '', definition: '', note: '' };
}

// ── mapDetailToForm ───────────────────────────────────────────────────────────

/**
 * Maps a TeacherTextDetail (from the API) to the FormState used by the editor.
 * Called by openEditForm.
 */
export function mapDetailToForm(detail: TeacherTextDetail): FormState {
  const paras = detail.paragraphs.length > 0 ? detail.paragraphs : [''];
  const vocab: VocabFormItem[] = detail.vocabulary
    ? detail.vocabulary.map((v) => ({
        word: v.word,
        definition: v.definition,
        note: v.note ?? '',
      }))
    : [];

  return {
    title: detail.title,
    grade: detail.grade,
    genre: detail.genre,
    text_type: detail.text_type,
    reading_strategy: detail.reading_strategy ?? '',
    paragraphs: paras,
    vocabulary: vocab,
  };
}

// ── buildSavePayload ──────────────────────────────────────────────────────────

/**
 * Converts FormState to a TeacherTextCreateRequest payload suitable for the API.
 * - Trims whitespace from all text fields.
 * - Removes blank paragraphs.
 * - Removes vocab items where word or definition is empty after trim.
 * - Sets reading_strategy to undefined when blank.
 * - Sets vocab note to undefined when blank.
 * - Sets vocabulary to undefined when the filtered list is empty.
 */
export function buildSavePayload(form: FormState): TeacherTextCreateRequest {
  const validParagraphs = form.paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const validVocab: VocabItem[] = form.vocabulary
    .filter((v) => v.word.trim() && v.definition.trim())
    .map((v) => ({
      word: v.word.trim(),
      definition: v.definition.trim(),
      note: v.note.trim() || undefined,
    }));

  return {
    title: form.title.trim(),
    grade: form.grade,
    genre: form.genre,
    text_type: form.text_type,
    reading_strategy: form.reading_strategy.trim() || undefined,
    paragraphs: validParagraphs,
    vocabulary: validVocab.length > 0 ? validVocab : undefined,
  };
}

// ── deleteResetState ──────────────────────────────────────────────────────────

/**
 * Returns the state slice to apply after a successful delete.
 * The list reload itself is a side effect handled by the orchestrator.
 */
export function deleteResetState(): { confirmDeleteId: null } {
  return { confirmDeleteId: null };
}
