/**
 * HeatmapChart — student × story performance grid.
 *
 * Rows = students, Columns = stories.
 * Cell colors: green (>=80), yellow (60-79), red (<60), gray (no data).
 * Hover shows exact score.
 */

import React from 'react';
import { ClassroomHeatmap } from '../../services/teacherApi';

interface HeatmapChartProps {
  data: ClassroomHeatmap;
}

function getScoreColor(score: number | null, status: string | null): string {
  if (score === null || status === null) return 'bg-gray-100 text-gray-400';
  if (score >= 80) return 'bg-green-400 text-white';
  if (score >= 60) return 'bg-yellow-400 text-white';
  return 'bg-red-400 text-white';
}

function getScoreLabel(score: number | null): string {
  if (score === null) return '-';
  return String(Math.round(score));
}

const HeatmapChart: React.FC<HeatmapChartProps> = ({ data }) => {
  const { students, stories, scores } = data;

  if (students.length === 0 || stories.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        尚無學習記錄可顯示熱力圖
      </div>
    );
  }

  // Build lookup: "student_id:story_id" -> score entry
  const scoreMap = new Map<string, { score: number; status: string }>();
  for (const entry of scores) {
    scoreMap.set(`${entry.student_id}:${entry.story_id}`, {
      score: entry.score,
      status: entry.status,
    });
  }

  return (
    <div className="overflow-auto max-h-[500px]">
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-white z-10">
          <tr>
            {/* Student name column header */}
            <th className="sticky left-0 bg-white z-20 px-3 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 min-w-[100px]">
              學生
            </th>
            {stories.map((story) => (
              <th
                key={story.id}
                className="px-2 py-2 font-medium text-gray-600 border-b border-gray-200 max-w-[80px] whitespace-nowrap overflow-hidden text-ellipsis"
                title={story.title}
              >
                <span className="block truncate max-w-[72px]">{story.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map((student, rowIdx) => (
            <tr
              key={student.id}
              className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
            >
              {/* Student name cell — sticky left */}
              <td className="sticky left-0 bg-inherit px-3 py-1.5 text-gray-800 font-medium border-r border-gray-200 min-w-[100px] whitespace-nowrap">
                {student.name}
              </td>
              {stories.map((story) => {
                const key = `${student.id}:${story.id}`;
                const entry = scoreMap.get(key) ?? null;
                const score = entry ? entry.score : null;
                const status = entry ? entry.status : null;
                const colorClass = getScoreColor(score, status);
                const label = getScoreLabel(score);
                const tooltip = entry
                  ? `${student.name} / ${story.title}: ${score} 分 (${status})`
                  : `${student.name} / ${story.title}: 尚未練習`;

                return (
                  <td
                    key={story.id}
                    className="px-1 py-1 text-center"
                    title={tooltip}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-9 h-7 rounded text-xs font-semibold ${colorClass}`}
                    >
                      {label}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 px-1 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">圖例：</span>
        <LegendItem color="bg-green-400" label="優秀 (≥80)" />
        <LegendItem color="bg-yellow-400" label="良好 (60-79)" />
        <LegendItem color="bg-red-400" label="需加強 (<60)" />
        <LegendItem color="bg-gray-100 border border-gray-300 text-gray-400" label="尚未練習" />
      </div>
    </div>
  );
};

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-5 h-4 rounded text-xs ${color}`} />
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

export default HeatmapChart;
