/**
 * useStudentAnswers — 從課堂即時直接跳到「這位學生現在寫了什麼」（#3220 第三期）。
 *
 * ## 為什麼是找 session 而不是新開一支 API
 *
 * 教師端要看學生的逐關作答，需要的三塊都已經存在：
 *
 *   1. `GET /teacher/students/{id}/sessions` 只用 `student_id` 過濾
 *      （`teacher_student_sessions.py`），**進行中的場次也在清單裡**
 *   2. `GET /teacher/students/{id}/sessions/{sid}/report` 的授權走
 *      `_get_session_for_teacher`，那支**不看 status**，所以進行中的場次
 *      本來就讀得到，回傳含 `step_progress.step_data`
 *   3. 該頁已改用 `StepRecordsView` 渲染那份資料（本 PR 第二期）
 *
 * 所以這一段是把既有的三塊接起來，不需要任何後端改動。
 *
 * ## 為什麼不能直接從 live-monitor 的資料拿 session id
 *
 * `LiveMonitorStudentEntry` 只有 `lesson_id`，沒有 session id —— 它的資料源是
 * `mcq_attempt`，而那張表**沒有 session_id 欄位**
 * （`backend/app/models/mcq_attempt.py`）。所以只能另外查一次場次清單。
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getStudentSessions } from '../../../services/teacherApi';

/** 後端 `LearningSession.status` 的完成值；其餘一律視為進行中。 */
const COMPLETED = 'completed';

export function useStudentAnswers(token: string | null) {
  const navigate = useNavigate();
  const [loadingStudentId, setLoadingStudentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openAnswers = useCallback(
    async (studentId: number) => {
      setError(null);
      setLoadingStudentId(studentId);
      try {
        const sessions = await getStudentSessions(token ?? '', studentId);
        // 清單已由後端依 started_at desc 排序，取第一筆未完成的即為「現在這場」
        const current = sessions.find((s) => s.status !== COMPLETED);
        const target = current ?? sessions[0];
        if (!target) {
          setError('這位學生還沒有任何練習紀錄');
          return;
        }
        navigate(`/teacher/students/${studentId}/sessions/${target.id}/report`);
      } catch {
        setError('無法開啟作答紀錄，請稍後再試');
      } finally {
        setLoadingStudentId(null);
      }
    },
    [navigate, token],
  );

  return { openAnswers, loadingStudentId, error };
}
