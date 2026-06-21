/**
 * AssignmentSubmissionTable — renders the student submission list (Issue #1936).
 *
 * Extracted from AssignmentDetailPanel.tsx.
 * Handles:
 *   - Mobile card view (each student as a card)
 *   - Desktop table view (grouped by student or flat)
 *   - Inline grading inputs (score + feedback textarea)
 *   - Expand/collapse reading metrics per row
 *   - Expand/collapse attempt history for multi-attempt students
 */
import React, { useState, useRef, useCallback } from 'react';
import type {
  SubmissionResponse,
  StudentAttemptGroup,
} from '../../../services/assignmentApi';
import ReadingMetricsPanel from './ReadingMetricsPanel';
import AttemptHistoryPanel from './AttemptHistoryPanel';
import { statusBadge, formatDate } from '../assignmentDetailUtils.tsx';
import { getSubmissionReadingAudio } from '../../../services/teacherApi';

// ── PlayAudioButton — inline audio replay for a submission (Issue #2326) ──────
/** Fetches a 10-min signed URL and plays the student's reading recording.
 *  Gracefully shows "無錄音" when the backend returns 404 (no recording).
 *  Declared BEFORE the table component to avoid TDZ (frontend-render-safety rule). */
interface PlayAudioButtonProps {
  assignmentId: number;
  submissionId: number;
}

const PlayAudioButton: React.FC<PlayAudioButtonProps> = ({
  assignmentId,
  submissionId,
}) => {
  const [loading, setLoading] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const handleClick = useCallback(async () => {
    // Toggle stop if already playing
    if (isPlaying) {
      stopPlayback();
      return;
    }
    setLoading(true);
    try {
      const result = await getSubmissionReadingAudio('', assignmentId, submissionId);
      if (!result) {
        setNoAudio(true);
        return;
      }
      const audio = new Audio(result.signed_url);
      audioRef.current = audio;
      audio.onended = () => {
        setIsPlaying(false);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setIsPlaying(false);
        audioRef.current = null;
      };
      audio.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {
        setIsPlaying(false);
        audioRef.current = null;
      });
    } catch (_e) {
      // Unexpected error — surface as no audio
      setNoAudio(true);
    } finally {
      setLoading(false);
    }
  }, [assignmentId, submissionId, isPlaying, stopPlayback]);

  if (noAudio) {
    return <span className="text-gray-300 text-xs">無錄音</span>;
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={isPlaying ? '停止播放' : '播放錄音'}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-green-200 text-green-700 text-xs hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
    >
      {loading ? '...' : isPlaying ? '■ 停止' : '▶ 聽錄音'}
    </button>
  );
};


export interface GradeFormProps {
  gradingId: number | null;
  gradeInput: Record<number, string>;
  feedbackInput: Record<number, string>;
  savingId: number | null;
  setGradeInput: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  setFeedbackInput: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  onGradeClick: (sub: SubmissionResponse) => void;
  onSaveGrade: (sub: SubmissionResponse) => void;
  onCancelGrade: () => void;
}

interface Props {
  submissions: SubmissionResponse[];
  groups: StudentAttemptGroup[];
  useGrouped: boolean;
  gradeForm: GradeFormProps;
  /** Assignment ID passed down for audio replay (grouped rows lack it on AttemptResponse). */
  assignmentId: number;
}

const AssignmentSubmissionTable: React.FC<Props> = ({
  submissions,
  groups,
  useGrouped,
  gradeForm,
  assignmentId,
}) => {
  const {
    gradingId,
    gradeInput,
    feedbackInput,
    savingId,
    setGradeInput,
    setFeedbackInput,
    onGradeClick,
    onSaveGrade,
    onCancelGrade,
  } = gradeForm;

  const [expandedMetricsId, setExpandedMetricsId] = useState<number | null>(null);
  const [expandedStudentId, setExpandedStudentId] = useState<number | null>(null);

  // ── Mobile card view ──────────────────────────────────────────────────────

  const renderMobileCard = (sub: SubmissionResponse) => (
    <div key={sub.id} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-900 text-sm">{sub.student_name}</span>
        <div className="flex items-center gap-2">
          {statusBadge(sub.status)}
          {gradingId === sub.id ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onSaveGrade(sub)}
                disabled={savingId === sub.id}
                className="px-2 py-0.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 cursor-pointer transition-colors"
              >
                {savingId === sub.id ? '...' : '儲存'}
              </button>
              <button
                onClick={onCancelGrade}
                className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
              >
                取消
              </button>
            </div>
          ) : (sub.status === 'submitted' || sub.status === 'graded') ? (
            <button
              onClick={() => onGradeClick(sub)}
              className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
            >
              {sub.status === 'graded' ? '重新批改' : '批改'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-xs text-gray-400">提交時間</span>
          <p className="text-gray-700">{formatDate(sub.submitted_at)}</p>
        </div>
        <div>
          <span className="text-xs text-gray-400">分數</span>
          {gradingId === sub.id ? (
            <input
              type="number"
              min="0"
              max="100"
              value={gradeInput[sub.id] ?? ''}
              onChange={(e) =>
                setGradeInput((prev) => ({ ...prev, [sub.id]: e.target.value }))
              }
              className="w-20 h-7 px-2 rounded border border-gray-300 text-center text-sm text-gray-900 bg-white focus:outline-none focus:border-accent"
              placeholder="0-100"
            />
          ) : (
            <p className="text-gray-700 font-medium">
              {sub.score != null ? `${Math.round(sub.score)}%` : '-'}
            </p>
          )}
        </div>
      </div>

      {(sub.reading_accuracy != null || sub.reading_cpm != null || sub.reading_error_chars.length > 0) && (
        <div>
          <button
            onClick={() => setExpandedMetricsId((prev) => (prev === sub.id ? null : sub.id))}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-blue-200 text-blue-600 text-xs hover:bg-blue-50 cursor-pointer transition-colors"
          >
            {expandedMetricsId === sub.id ? '收合朗讀數據' : '查看朗讀數據'}
          </button>
          {expandedMetricsId === sub.id && (
            <div className="mt-2">
              <ReadingMetricsPanel
                studentName={sub.student_name}
                readingAccuracy={sub.reading_accuracy}
                readingCpm={sub.reading_cpm}
                readingErrorChars={sub.reading_error_chars}
              />
            </div>
          )}
        </div>
      )}

      {gradingId === sub.id ? (
        <div>
          <span className="text-xs text-gray-400">評語</span>
          <textarea
            value={feedbackInput[sub.id] ?? ''}
            onChange={(e) =>
              setFeedbackInput((prev) => ({ ...prev, [sub.id]: e.target.value }))
            }
            placeholder="輸入個別評語（選填）"
            rows={2}
            className="w-full mt-1 px-2 py-1.5 rounded border border-gray-300 text-xs text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:border-accent resize-none"
          />
        </div>
      ) : sub.teacher_feedback ? (
        <div>
          <span className="text-xs text-gray-400">評語</span>
          <p className="text-gray-600 text-sm mt-0.5 line-clamp-2" title={sub.teacher_feedback}>
            {sub.teacher_feedback}
          </p>
        </div>
      ) : null}

      {(sub.status === 'submitted' || sub.status === 'graded') && (
        <div>
          <PlayAudioButton
            assignmentId={sub.assignment_id}
            submissionId={sub.id}
          />
        </div>
      )}
    </div>
  );

  // ── Desktop table — grouped view ──────────────────────────────────────────

  const renderGroupedRows = () =>
    groups.map((group) => {
      const latest = group.attempts[0]; // sorted desc by attempt_number
      const isExpanded = expandedStudentId === group.student_id;
      // Cast: AttemptResponse is structurally compatible with SubmissionResponse for grading
      const latestAsSub = latest as unknown as SubmissionResponse;

      return (
        <React.Fragment key={group.student_id}>
          <tr>
            <td className="py-1.5 text-gray-700">
              <div className="flex items-center gap-1">
                {group.attempts.length > 1 && (
                  <button
                    onClick={() =>
                      setExpandedStudentId((prev) =>
                        prev === group.student_id ? null : group.student_id
                      )
                    }
                    className="inline-flex items-center justify-center w-4 h-4 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 cursor-pointer transition-colors"
                    title={isExpanded ? '收合歷史作答' : '展開歷史作答'}
                  >
                    {isExpanded ? '−' : '+'}
                  </button>
                )}
                {group.student_name}
              </div>
            </td>
            <td className="py-1.5 text-center">{statusBadge(group.latest_status)}</td>
            <td className="py-1.5 text-center text-gray-500">{group.attempts.length}</td>
            <td className="py-1.5 text-gray-700 text-center font-medium">
              {gradingId === latest.id ? (
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={gradeInput[latest.id] ?? ''}
                  onChange={(e) =>
                    setGradeInput((prev) => ({ ...prev, [latest.id]: e.target.value }))
                  }
                  className="w-16 h-6 px-1.5 rounded border border-gray-300 text-center text-xs focus:outline-none focus:border-accent"
                  placeholder="0-100"
                />
              ) : latest.score != null ? (
                `${Math.round(latest.score)}%`
              ) : (
                '-'
              )}
            </td>
            <td className="py-1.5 text-center">
              {latest.reading_accuracy != null || latest.reading_cpm != null || latest.reading_error_chars.length > 0 ? (
                <button
                  onClick={() =>
                    setExpandedMetricsId((prev) => (prev === latest.id ? null : latest.id))
                  }
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-blue-200 text-blue-600 text-xs hover:bg-blue-50 cursor-pointer transition-colors"
                  title="展開朗讀數據"
                >
                  {expandedMetricsId === latest.id ? '收合' : '查看'}
                </button>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </td>
            <td className="py-1.5 max-w-[200px]">
              {gradingId === latest.id ? (
                <textarea
                  value={feedbackInput[latest.id] ?? ''}
                  onChange={(e) =>
                    setFeedbackInput((prev) => ({ ...prev, [latest.id]: e.target.value }))
                  }
                  placeholder="輸入個別評語（選填）"
                  rows={2}
                  className="w-full px-1.5 py-1 rounded border border-gray-300 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-accent resize-none"
                />
              ) : latest.teacher_feedback ? (
                <span className="text-gray-600 line-clamp-2" title={latest.teacher_feedback}>
                  {latest.teacher_feedback}
                </span>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </td>
            <td className="py-1.5 text-center">
              {gradingId === latest.id ? (
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={() => onSaveGrade(latestAsSub)}
                    disabled={savingId === latest.id}
                    className="px-2 py-0.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {savingId === latest.id ? '...' : '儲存'}
                  </button>
                  <button
                    onClick={onCancelGrade}
                    className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    取消
                  </button>
                </div>
              ) : latest.status === 'submitted' || latest.status === 'graded' ? (
                <button
                  onClick={() => onGradeClick(latestAsSub)}
                  className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  {latest.status === 'graded' ? '重新批改' : '批改'}
                </button>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </td>
            <td className="py-1.5 text-center">
              {(latest.status === 'submitted' || latest.status === 'graded') ? (
                <PlayAudioButton
                  assignmentId={assignmentId}
                  submissionId={latest.id}
                />
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </td>
          </tr>
          {expandedMetricsId === latest.id && (
            <tr>
              <td colSpan={8} className="pb-2 pt-0">
                <ReadingMetricsPanel
                  studentName={group.student_name}
                  readingAccuracy={latest.reading_accuracy}
                  readingCpm={latest.reading_cpm}
                  readingErrorChars={latest.reading_error_chars}
                />
              </td>
            </tr>
          )}
          {isExpanded && (
            <AttemptHistoryPanel attempts={group.attempts.slice(1)} />
          )}
        </React.Fragment>
      );
    });

  // ── Desktop table — flat view ─────────────────────────────────────────────

  const renderFlatRows = () =>
    submissions.map((sub) => (
      <React.Fragment key={sub.id}>
        <tr>
          <td className="py-1.5 text-gray-700">{sub.student_name}</td>
          <td className="py-1.5 text-center">{statusBadge(sub.status)}</td>
          <td className="py-1.5 text-gray-500">{formatDate(sub.submitted_at)}</td>
          <td className="py-1.5 text-gray-700 text-center font-medium">
            {gradingId === sub.id ? (
              <input
                type="number"
                min="0"
                max="100"
                value={gradeInput[sub.id] ?? ''}
                onChange={(e) =>
                  setGradeInput((prev) => ({
                    ...prev,
                    [sub.id]: e.target.value,
                  }))
                }
                className="w-16 h-6 px-1.5 rounded border border-gray-300 text-center text-xs focus:outline-none focus:border-accent"
                placeholder="0-100"
              />
            ) : sub.score != null ? (
              `${Math.round(sub.score)}%`
            ) : (
              '-'
            )}
          </td>
          <td className="py-1.5 text-center">
            {sub.reading_accuracy != null || sub.reading_cpm != null || sub.reading_error_chars.length > 0 ? (
              <button
                onClick={() =>
                  setExpandedMetricsId((prev) => (prev === sub.id ? null : sub.id))
                }
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-blue-200 text-blue-600 text-xs hover:bg-blue-50 cursor-pointer transition-colors"
                title="展開朗讀數據"
              >
                {expandedMetricsId === sub.id ? '收合' : '查看'}
              </button>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </td>
          <td className="py-1.5 max-w-[200px]">
            {gradingId === sub.id ? (
              <textarea
                value={feedbackInput[sub.id] ?? ''}
                onChange={(e) =>
                  setFeedbackInput((prev) => ({
                    ...prev,
                    [sub.id]: e.target.value,
                  }))
                }
                placeholder="輸入個別評語（選填）"
                rows={2}
                className="w-full px-1.5 py-1 rounded border border-gray-300 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-accent resize-none"
              />
            ) : sub.teacher_feedback ? (
              <span className="text-gray-600 line-clamp-2" title={sub.teacher_feedback}>
                {sub.teacher_feedback}
              </span>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </td>
          <td className="py-1.5 text-center">
            {gradingId === sub.id ? (
              <div className="flex items-center justify-center gap-1">
                <button
                  onClick={() => onSaveGrade(sub)}
                  disabled={savingId === sub.id}
                  className="px-2 py-0.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {savingId === sub.id ? '...' : '儲存'}
                </button>
                <button
                  onClick={onCancelGrade}
                  className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  取消
                </button>
              </div>
            ) : sub.status === 'submitted' || sub.status === 'graded' ? (
              <button
                onClick={() => onGradeClick(sub)}
                className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
              >
                {sub.status === 'graded' ? '重新批改' : '批改'}
              </button>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </td>
          <td className="py-1.5 text-center">
            {(sub.status === 'submitted' || sub.status === 'graded') ? (
              <PlayAudioButton
                assignmentId={sub.assignment_id}
                submissionId={sub.id}
              />
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </td>
        </tr>
        {expandedMetricsId === sub.id && (
          <tr>
            <td colSpan={8} className="pb-2 pt-0">
              <ReadingMetricsPanel
                studentName={sub.student_name}
                readingAccuracy={sub.reading_accuracy}
                readingCpm={sub.reading_cpm}
                readingErrorChars={sub.reading_error_chars}
              />
            </td>
          </tr>
        )}
      </React.Fragment>
    ));

  return (
    <>
      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {submissions.map(renderMobileCard)}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="pb-1.5 font-medium">學生姓名</th>
              <th className="pb-1.5 font-medium text-center">最新狀態</th>
              <th className="pb-1.5 font-medium text-center">作答次數</th>
              <th className="pb-1.5 font-medium text-center">最新分數</th>
              <th className="pb-1.5 font-medium text-center">朗讀數據</th>
              <th className="pb-1.5 font-medium">評語</th>
              <th className="pb-1.5 font-medium text-center">批改</th>
              <th className="pb-1.5 font-medium text-center">錄音</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {useGrouped ? renderGroupedRows() : renderFlatRows()}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default AssignmentSubmissionTable;
