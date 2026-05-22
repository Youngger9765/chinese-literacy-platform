import {
  StoryAdminListItem,
  StoryCreateRequest,
} from '../../services/adminStoryApi';

export type ModalMode = 'create' | 'edit';

export interface StoryFormState {
  lesson_number: string;
  title: string;
  grade: string;
  grade_code: string;
  genre: string;
  text_type: string;
  reading_strategy: string;
  paragraphs: string;
  source_file: string;
}

export const EMPTY_FORM: StoryFormState = {
  lesson_number: '',
  title: '',
  grade: '4',
  grade_code: '',
  genre: '記敘文',
  text_type: '單',
  reading_strategy: '',
  paragraphs: '',
  source_file: '',
};

export const GENRE_OPTIONS = ['記敘文', '說明文', '議論文', '文言文', '應用文'];
export const TEXT_TYPE_OPTIONS = ['單', '多*2', '多*3'];

export function formToCreateRequest(form: StoryFormState): StoryCreateRequest {
  return {
    lesson_number: parseInt(form.lesson_number, 10),
    title: form.title.trim(),
    grade: parseInt(form.grade, 10),
    grade_code: form.grade_code.trim(),
    genre: form.genre,
    text_type: form.text_type,
    reading_strategy: form.reading_strategy.trim() || undefined,
    paragraphs: form.paragraphs
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean),
    source_file: form.source_file.trim() || undefined,
  };
}

export function storyToFormState(story: StoryAdminListItem): StoryFormState {
  return {
    lesson_number: String(story.lesson_number),
    title: story.title,
    grade: String(story.grade),
    grade_code: story.grade_code,
    genre: story.genre,
    text_type: story.text_type,
    reading_strategy: story.reading_strategy ?? '',
    paragraphs: '',
    source_file: story.source_file ?? '',
  };
}
