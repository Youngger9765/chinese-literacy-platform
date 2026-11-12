/**
 * TeacherSessionReportPage — teacher view of a student's learning session report.
 *
 * #3749：報告區塊改用跟學生端（SessionHistoryReportPage / ReportPage）同一套
 * 「關卡完成卡片」（StepReportCards + reportCardsModel.ts），拿掉 AssessmentReport。
 * TeacherCommentSection（AI/老師評語）、SpotlightStrategyRecord、
 * VocabApplicationRecord、「作答紀錄」（StepRecordsView）這些老師專屬或已經在
 * 做同一件事（逐題明細）的區塊不動。
 *
 * ⚠️ 記號（讀全文-做記號）在這裡沒有資料：annotation_entries 的擁有權檢查只認
 * 學生本人（learning_annotations.py 的 get_owned_session），後端沒有教師專屬的
 * annotations 端點，所以卡片的「做記號」細節在老師端直接略過
 * （buildStepReportCards 的第 4 個參數傳 undefined，見 reportCardsModel.ts）——
 * 不是假裝「沒有做記號」，是老實地不顯示那段細節。
 *
 * Route: /teacher/students/:studentId/sessions/:sessionId/report
 * Issue #993
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStory } from '../../services/api';
import {
  fetchTeacherSessionReport,
  type TeacherSessionReport,
} from '../../services/teacherApi';
import type { Story } from '../../types';
import TeacherCommentSection from '../../components/teacher/TeacherCommentSection';
import PageLoader from '../../components/ui/PageLoader';
import { SpotlightStrategyRecord } from '../student/session-history/SpotlightStrategyRecord';
import { VocabApplicationRecord } from '../student/session-history/VocabApplicationRecord';
import { StepRecordsView } from '../student/session-history/StepRecordsView';
import { buildComprehensionScores } from '../student/session-history/helpers';
import { getTeacherStudentDialogue } from '../../services/teacherApi';
import type { SessionDetailResponse } from '../../services/learningApi';
import { resolveActiveSteps } from '../../config/stepConfig';
import StepReportCards from '../../components/report/StepReportCards';
import { buildStepReportCards } from '../../components/report/reportCardsModel';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TeacherSessionReportPage: React.FC = () => {
  const { studentId, sessionId } = useParams<{ studentId: string; sessionId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [report, setReport] = useState<TeacherSessionReport | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !studentId || !sessionId) return;
    const sid = Number(studentId);
    const sessId = Number(sessionId);
    if (isNaN(sid) || isNaN(sessId)) {
      setError('無效的 ID');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    fetchTeacherSessionReport(token, sid, sessId)
      .then(async (detail) => {
        setReport(detail);

        if (detail.story_slug) {
          try {
            const s = await fetchStory(detail.story_slug);
            setStory(s);
          } catch {
            // Non-critical
          }
        }
      })
      .catch((err: Error) => {
        setError(err.message || '無法載入學習報告');
      })
      .finally(() => setIsLoading(false));
  }, [token, studentId, sessionId]);

  const cards = useMemo(
    () =>
      buildStepReportCards(
        resolveActiveSteps(story?.stepSequence),
        report?.step_progress?.steps_completed,
        report?.step_progress?.step_data,
        undefined,
      ),
    [story, report],
  );

  if (isLoading) return <PageLoader />;

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto w-full">
      {/* Header with student name and story */}
      {report && (
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {report.student_name} 的學習報告
            </h1>
            {report.story_title && (
              <p className="text-sm text-gray-500 mt-1">{report.story_title}</p>
            )}
          </div>
          <button
            onClick={() => navigate(-1)}
            className="btn-secondary text-sm"
          >
            返回
          </button>
        </div>
      )}

      {/* Teacher comment section — above report so teacher doesn't scroll past empty sections */}
      {report && token && (
        <TeacherCommentSection
          studentId={Number(studentId)}
          sessionId={Number(sessionId)}
          token={token}
          aiComment={report.ai_comment}
          teacherComment={report.teacher_comment}
          teacherReviewedAt={report.teacher_reviewed_at}
          studentName={report.student_name}
        />
      )}


      {/* Issue #2083 — structured spotlight answers for teacher review */}
      {report?.step_progress?.step_data?.['spotlight'] && (
        <div className="mb-6">
          <SpotlightStrategyRecord
            stepData={report.step_progress.step_data['spotlight'] as Record<string, unknown>}
            spotlight={story?.spotlightV2}
            strategyExercise={
              story?.strategyExercise && !Array.isArray(story.strategyExercise)
                ? story.strategyExercise
                : null
            }
          />
        </div>
      )}

      {/* Issue #3682 跟進 — session.vocab_result 從不被現行 VocabApplication.tsx
          寫入，真正的填空作答存在 step_progress.step_data['vocab-application']。
          跟 spotlight 同一個道理：直接讀 step_progress，不要經過死欄位。 */}
      {report?.step_progress?.step_data?.['vocab-application'] && (
        <div className="mb-6">
          <VocabApplicationRecord
            stepData={report.step_progress.step_data['vocab-application'] as Record<string, unknown>}
          />
        </div>
      )}

      {/* #3749：關卡完成卡片，跟學生端同一套元件。
          Use is_complete from backend (#1911) — same criterion as the progress table
          (status == 'completed'). Avoids false "尚未完成" when result JSONB fields
          are null but the session is actually complete. */}
      {report && !report.is_complete ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-500">學生尚未完成此課文的學習，暫無報告資料</p>
        </div>
      ) : (
        report && <StepReportCards storyTitle={story?.title ?? report.story_title ?? undefined} cards={cards} />
      )}

      {/* #3220 第二期：這裡原本是 #1549 留下的 `JSON.stringify(step_progress)`
          placeholder —— 資料早就送到教師端了，只是以 raw JSON 呈現，老師讀不了。
          學生端「作答紀錄」分頁用的 StepRecordsView 渲染的就是同一份資料，
          所以這裡重用它，而不是另寫一套。

          ⚠️ 對話來源必須注入教師端那支：StepRecordsView 預設打
          `/learning/sessions/{id}/dialogue`，那走 get_owned_session，
          老師打會 403。 */}
      {report?.step_progress && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-bold text-gray-900">
            作答紀錄
            <span className="ml-2 text-xs font-normal text-gray-400">
              {(report.step_progress.steps_completed?.length ?? 0)} 步已完成
            </span>
          </h2>
          <StepRecordsView
            // 教師端的 28 個欄位完整涵蓋 SessionDetailResponse 的 19 個
            // （由 TeacherSessionReportPage.stepRecords.test.tsx 的型別斷言守著，
            //   任一邊欄位漂移會在 build 期就紅，不會等到執行期破圖）
            detail={report as unknown as SessionDetailResponse}
            comprehensionScores={buildComprehensionScores(
              report as unknown as SessionDetailResponse,
            )}
            token={token!}
            sessionId={Number(sessionId)}
            loadDialogue={() =>
              getTeacherStudentDialogue(token!, Number(studentId), Number(sessionId)).then(
                (r) => r.turns,
              )
            }
          />
        </div>
      )}
    </div>
  );
};

export default TeacherSessionReportPage;
