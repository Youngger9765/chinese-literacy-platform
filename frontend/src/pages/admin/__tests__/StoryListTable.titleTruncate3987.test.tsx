/**
 * Regression lock for #3987 UI-7: the six metadata columns (編號/年級/文體/
 * 段落數/字數/操作) carried fixed Tailwind widths that already summed to
 * ~500px — on a narrower desktop (1024px, admin tree sidebar eating another
 * ~230px) that left almost nothing for the title column, so every title
 * wrapped 3-4 lines tall. Capped + truncated instead, with the full title
 * still reachable via the native `title=""` tooltip on hover.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StoryListTable from '../StoryListTable';
import type { StoryAdminListItem } from '../../../services/adminStoryApi';

const LONG_TITLE = '勇敢面對挑戰：一個關於友情、信任與成長的長篇故事標題測試用文字';

const STORY: StoryAdminListItem = {
  lesson_number: 1,
  title: LONG_TITLE,
  grade: 4,
  grade_code: 'G4',
  genre: '記敘文',
  text_type: '記敘文',
  paragraph_count: 5,
  char_count: 500,
  reading_strategy: null,
  source_file: null,
};

function renderTable() {
  return render(
    <StoryListTable
      stories={[STORY]}
      isLoading={false}
      loadError=""
      searchQuery=""
      gradeFilter=""
      onSearchChange={() => {}}
      onGradeChange={() => {}}
      onRetry={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );
}

describe('StoryListTable title column cap + truncate (#3987 UI-7)', () => {
  it('caps the desktop title <td> so the other 6 metadata columns keep their space', () => {
    const { container } = renderTable();
    const cells = Array.from(container.querySelectorAll('td'));
    const titleCell = cells.find((td) => td.className.includes('max-w-[160px]'));
    expect(titleCell).toBeTruthy();
    expect(titleCell!.className).toContain('md:max-w-[220px]');
    expect(titleCell!.className).toContain('xl:max-w-xs');
  });

  it('truncates the title visually but keeps it fully reachable via the title="" tooltip', () => {
    renderTable();
    const titleSpans = screen.getAllByTitle(LONG_TITLE);
    expect(titleSpans.length).toBeGreaterThan(0);
    for (const span of titleSpans) {
      expect(span.className.split(/\s+/)).toContain('truncate');
      expect(span.textContent).toBe(LONG_TITLE);
    }
  });
});
