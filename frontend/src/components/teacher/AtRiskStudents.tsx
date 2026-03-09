/**
 * AtRiskStudents — Issue #254: Predictive Learning Difficulty Detection.
 *
 * Displays a classroom's at-risk students with colour-coded risk level badges,
 * risk factor lists, and recommended intervention actions.
 *
 * Shows only medium/high-risk students by default with a toggle for all students.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getAtRiskStudents, AtRiskStudent } from '../../services/teacherApi';

interface AtRiskStudentsProps {
  classroomId: number;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: AtRiskStudent['risk_level'] }) {
  const styles: Record<AtRiskStudent['risk_level'], string> = {
    high: 'bg-red-100 text-red-800 border-red-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-green-100 text-green-800 border-green-200',
  };
  const labels: Record<AtRiskStudent['risk_level'], string> = {
    high: '高風險',
    medium: '中風險',
    low: '低風險',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[level]}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          level === 'high' ? 'bg-red-500' : level === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
        }`}
      />
      {labels[level]}
    </span>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 70 ? 'bg-red-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-green-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-7 text-right">{pct}%</span>
    </div>
  );
}

// ── Student card ──────────────────────────────────────────────────────────────

function StudentRiskCard({ student }: { student: AtRiskStudent }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails =
    student.risk_factors.length > 0 || student.recommended_actions.length > 0;

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        student.risk_level === 'high'
          ? 'border-red-200 bg-red-50'
          : student.risk_level === 'medium'
          ? 'border-yellow-200 bg-yellow-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{student.student_name}</span>
            <RiskBadge level={student.risk_level} />
          </div>

          {student.risk_level !== 'low' && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">預測可信度</p>
              <ConfidenceBar score={student.confidence_score} />
            </div>
          )}

          {/* Quick summary of first risk factor */}
          {!expanded && student.risk_factors.length > 0 && (
            <p className="mt-2 text-xs text-gray-600 line-clamp-1">
              {student.risk_factors[0]}
              {student.risk_factors.length > 1 && (
                <span className="text-gray-400"> 等 {student.risk_factors.length} 個風險因子</span>
              )}
            </p>
          )}
        </div>

        {hasDetails && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-xs text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
            aria-label={expanded ? '收合詳細資訊' : '展開詳細資訊'}
          >
            {expanded ? '收合' : '詳情'}
          </button>
        )}
      </div>

      {expanded && hasDetails && (
        <div className="mt-3 space-y-3 border-t border-gray-200 pt-3">
          {student.risk_factors.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">風險因子</p>
              <ul className="space-y-1">
                {student.risk_factors.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                    <span className="mt-0.5 shrink-0 text-red-400">&#9679;</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {student.recommended_actions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">建議介入方式</p>
              <ul className="space-y-1">
                {student.recommended_actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                    <span className="mt-0.5 shrink-0 text-blue-400">&#10003;</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const AtRiskStudents: React.FC<AtRiskStudentsProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const [students, setStudents] = useState<AtRiskStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    getAtRiskStudents(token, classroomId)
      .then(setStudents)
      .catch((err) => setError(err?.message ?? '無法載入風險預測資料'))
      .finally(() => setIsLoading(false));
  }, [token, classroomId]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      </div>
    );
  }

  const atRisk = students.filter((s) => s.risk_level !== 'low');
  const displayed = showAll ? students : atRisk;

  const highCount = students.filter((s) => s.risk_level === 'high').length;
  const medCount = students.filter((s) => s.risk_level === 'medium').length;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-gray-900">早期介入預測</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          根據學生前期練習訊號（正確率、錯字率、練習頻率）自動預測學習困難風險。
        </p>
      </div>

      {/* Summary badges */}
      {students.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {highCount > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full" />
              <span className="text-sm font-medium text-red-800">高風險 {highCount} 人</span>
            </div>
          )}
          {medCount > 0 && (
            <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
              <span className="w-2.5 h-2.5 bg-yellow-500 rounded-full" />
              <span className="text-sm font-medium text-yellow-800">中風險 {medCount} 人</span>
            </div>
          )}
          {highCount === 0 && medCount === 0 && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
              <span className="text-sm font-medium text-green-800">目前無高風險學生</span>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {students.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">班級尚無學生練習紀錄</p>
          <p className="text-xs mt-1">學生完成 3 次以上練習後，系統會自動進行風險預測。</p>
        </div>
      )}

      {/* Student list */}
      {displayed.length > 0 && (
        <div className="space-y-3">
          {displayed.map((s) => (
            <StudentRiskCard key={s.student_id} student={s} />
          ))}
        </div>
      )}

      {atRisk.length === 0 && students.length > 0 && !showAll && (
        <div className="text-center py-8 text-gray-400">
          <p className="text-sm">目前所有學生均為低風險</p>
        </div>
      )}

      {/* Toggle show all */}
      {students.length > 0 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors underline underline-offset-2 cursor-pointer"
        >
          {showAll
            ? `只顯示高/中風險學生（${atRisk.length} 人）`
            : `顯示全部學生（${students.length} 人）`}
        </button>
      )}

      {/* Explainability note */}
      <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
        預測依據：前期課文正確率、生字錯誤率、正確率趨勢、練習頻率、卡點數量。此為規則引擎預測，非機器學習模型，準確率隨學習紀錄增加而提升。
      </p>
    </div>
  );
};

export default AtRiskStudents;
