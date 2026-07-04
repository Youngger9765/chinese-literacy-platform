/**
 * Issue #2486 regression: fetchStory/fetchStories must resolve the backend's
 * same-origin-relative "/assets/..." URLs (thumbnail_url, worksheet_pdf_url,
 * worksheet_docx_url) onto ASSET_BASE before handing them to components.
 *
 * Root cause this locks: a real-browser QA pass on the PR preview (frontend
 * and backend on different Cloud Run origins) showed the lesson cover image
 * on Intro.tsx as a broken <img>. The backend correctly returns a relative
 * "/assets/stories/thumbnails/lesson-1.webp" path, but Intro.tsx renders it
 * as <img src={story.thumbnail}> directly — the browser resolved that
 * relative path against the FRONTEND's own origin (which has no such route,
 * and falls back to serving index.html), not the backend's. The fix belongs
 * in api.ts's response-mapping layer (the single choke point every consumer
 * — Intro.tsx, StoryCard.tsx — goes through), not in each component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../config/assetBase', () => ({
  ASSET_BASE: 'https://lingoleap-backend-issue-2486-oja2sffiya-de.a.run.app/assets',
}));

import { fetchStory, fetchStories } from './api';

function mockJsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const BASE_DETAIL_FIELDS = {
  lesson_number: 1,
  title: '贏得喝采的輸家',
  grade: 4,
  grade_code: 'G4-01',
  genre: '記敘文',
  category: 'Fable',
  char_count: 100,
  reading_strategy: null,
  intro: { author: 'x', background: 'y' },
  paragraphs: ['p1'],
  source_file: 'L1.yml',
};

describe('fetchStory / fetchStories — asset URL resolution (#2486)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('resolves a relative thumbnail_url onto ASSET_BASE (fetchStory)', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({
      ...BASE_DETAIL_FIELDS,
      thumbnail_url: '/assets/stories/thumbnails/lesson-1.webp',
    }));

    const story = await fetchStory('1');

    expect(story.thumbnail).toBe(
      'https://lingoleap-backend-issue-2486-oja2sffiya-de.a.run.app/assets/stories/thumbnails/lesson-1.webp',
    );
  });

  it('resolves relative worksheet_pdf_url and worksheet_docx_url onto ASSET_BASE', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({
      ...BASE_DETAIL_FIELDS,
      thumbnail_url: '/assets/stories/thumbnails/lesson-1.webp',
      worksheet_pdf_url: '/assets/worksheets/G4-L01.pdf',
      worksheet_docx_url: '/assets/worksheets/G4-L01.docx',
    }));

    const story = await fetchStory('1');

    expect(story.worksheetPdfUrl).toBe(
      'https://lingoleap-backend-issue-2486-oja2sffiya-de.a.run.app/assets/worksheets/G4-L01.pdf',
    );
    expect(story.worksheetDocxUrl).toBe(
      'https://lingoleap-backend-issue-2486-oja2sffiya-de.a.run.app/assets/worksheets/G4-L01.docx',
    );
  });

  it('leaves worksheet URLs undefined when absent (no false-positive resolution)', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({
      ...BASE_DETAIL_FIELDS,
      thumbnail_url: '/assets/stories/thumbnails/lesson-1.webp',
      worksheet_pdf_url: null,
      worksheet_docx_url: null,
    }));

    const story = await fetchStory('1');

    expect(story.worksheetPdfUrl).toBeUndefined();
    expect(story.worksheetDocxUrl).toBeUndefined();
  });

  it('resolves thumbnail_url for list items (fetchStories)', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({
      stories: [{
        lesson_number: 1,
        title: '贏得喝采的輸家',
        grade: 4,
        category: 'Fable',
        char_count: 100,
        intro: { author: 'x', background: 'y' },
        thumbnail_url: '/assets/stories/thumbnails/lesson-1.webp',
        genre: '記敘文',
      }],
      total: 1,
      grades: [4],
    }));

    const { stories } = await fetchStories();

    expect(stories[0].thumbnail).toBe(
      'https://lingoleap-backend-issue-2486-oja2sffiya-de.a.run.app/assets/stories/thumbnails/lesson-1.webp',
    );
  });
});
