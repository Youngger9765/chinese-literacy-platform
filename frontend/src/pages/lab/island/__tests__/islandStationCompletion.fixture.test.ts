/**
 * #3780 D（PRD §5.6）—— 前後端共用的「這站算不算完成」規則，讀同一份
 * `fixtures/island-station-completion.json`，斷言這裡算出來的
 * `stations_done` 跟後端 `test_island_station_completion_fixture.py`
 * 算出來的完全一致（同一個 CI 就會抓到任一邊漂移）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { isStationDone, countStationsDone } from '../islandTemplate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '../../../../../../fixtures/island-station-completion.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
  cases: Array<{
    name: string;
    step_sequence: string[];
    steps_completed: string[];
    has_session: boolean;
    expected_done_indexes: number[];
    expected_stations_done: number;
    expected_stations_total: number;
  }>;
};

describe('isStationDone / countStationsDone — 前後端共用 fixture', () => {
  // 先確認 fixture 真的讀到了（不是空陣列——空陣列會讓底下的 it.each 悄悄
  // 變成 0 條測試，看起來「沒有測試失敗」但其實什麼都沒測到）。
  it('fixture 至少有 5 個案例', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(5);
  });

  for (const c of fixture.cases) {
    it(`[${c.name}] done indexes 與 stations_done 跟 fixture 期望值一致`, () => {
      const doneIndexes = c.step_sequence.flatMap((_entry, index) =>
        isStationDone(c.step_sequence, index, c.steps_completed, c.has_session) ? [index] : [],
      );
      expect(doneIndexes).toEqual(c.expected_done_indexes);
      expect(countStationsDone(c.step_sequence, c.steps_completed, c.has_session)).toBe(c.expected_stations_done);
      expect(c.step_sequence.length).toBe(c.expected_stations_total);
    });
  }
});
