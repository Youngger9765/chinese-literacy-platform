/**
 * ErrorHeatmapChart — student × character error frequency grid.
 *
 * Rows = students, Columns = characters (sorted by total errors desc).
 * Cell color intensity = error count: white (0), light-orange (1-2),
 * orange (3-4), deep-red (5+).
 * Responsive: on small screens the table scrolls horizontally.
 */

import React from 'react';
import { ClassroomErrorHeatmap } from '../../services/teacherApi';

interface ErrorHeatmapChartProps {
  data: ClassroomErrorHeatmap;
}

function getErrorColor(count: number): string {
  if (count === 0) return 'bg-gray-100 text-gray-300';
  if (count <= 2) return 'bg-orange-200 text-orange-800';
  if (count <= 4) return 'bg-orange-400 text-white';
  return 'bg-red-500 text-white';
}

const ErrorHeatmapChart: React.FC<ErrorHeatmapChartProps> = ({ data }) => {
  const { students, characters, errors } = data;

  if (students.length === 0 || characters.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        尚無錯字記錄可顯示
      </div>
    );
  }

  // Build lookup: "student_id:character" -> error_count
  const errorMap = new Map<string, number>();
  for (const entry of errors) {
    errorMap.set(`${entry.student_id}:${entry.character}`, entry.error_count);
  }

  return (
    <div className="overflow-auto max-h-[500px]">
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-white z-10">
          <tr>
            {/* Student name column header */}
            <th className="sticky left-0 bg-white z-20 px-3 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 min-w-[90px]">
              學生
            </th>
            {characters.map((char) => (
              <th
                key={char}
                className="px-1 py-2 font-medium text-gray-600 border-b border-gray-200 w-10 min-w-[40px] text-center"
                title={char}
              >
                {char}
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
              <td className="sticky left-0 bg-inherit px-3 py-1.5 text-gray-800 font-medium border-r border-gray-200 min-w-[90px] whitespace-nowrap">
                {student.name}
              </td>
              {characters.map((char) => {
                const count = errorMap.get(`${student.id}:${char}`) ?? 0;
                const colorClass = getErrorColor(count);
                const tooltip = count > 0
                  ? `${student.name} / "${char}"：${count} 次錯誤`
                  : `${student.name} / "${char}"：無錯誤`;

                return (
                  <td
                    key={char}
                    className="px-1 py-1 text-center"
                    title={tooltip}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-8 h-7 rounded font-semibold ${colorClass}`}
                    >
                      {count > 0 ? count : ''}
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
        <LegendItem color="bg-gray-100 border border-gray-200 text-gray-300" label="無錯誤" />
        <LegendItem color="bg-orange-200 text-orange-800" label="1-2 次" />
        <LegendItem color="bg-orange-400 text-white" label="3-4 次" />
        <LegendItem color="bg-red-500 text-white" label="5 次以上" />
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

export default ErrorHeatmapChart;
