/**
 * useStudentRecommendations — 開啟「這位學生接下來該練什麼」的推薦頁。
 *
 * ## 為什麼這支叫 recommendations 而不是 preview
 *
 * `/teacher/preview/:studentId`（`StudentPreviewPage.tsx`）整頁只做一件事：
 * 呼叫 `getStoryRecommendations(token, studentId, 5)` 並列出五筆推薦課文。
 * 它**不顯示學生當下的畫面，也不顯示學生寫了什麼**。
 *
 * 但按鈕原本寫「預覽」、tooltip 原本寫「以學生身分預覽（唯讀）」，於是老師
 * （以及照著 UI 寫說明書的人）都以為點下去會看到學生的螢幕。#3027 的起因是
 * 兩則現場回饋——「想測試學生的視角」＋「依學生程度建議關聯課程」——實作解的
 * 是第二則，**名字卻借用了第一則的語言**，功能名與功能實體從第一天就對不上。
 *
 * 底層機制沒有改：仍然是短效唯讀 preview token（`sub` 指向學生、`preview=True`，
 * 由 `PreviewModeWriteGuardMiddleware` 擋掉所有非 GET）。改的只有命名。
 *
 * ## 為什麼抽成 hook
 *
 * `StudentProgressTab` 與 `LiveMonitorTab` 各有一份幾乎一字不差的 24 行複製
 * （差別只有 `setPreviewError(null)` vs `setPreviewError('')`）。任何一邊改了
 * 另一邊不會跟著改 —— 這次正名就同時要動兩處，正是那個成本的具體形狀。
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { requestPreviewToken } from '../../../services/teacherApi';

interface StudentLike {
  student_id: number;
}

export function useStudentRecommendations() {
  const navigate = useNavigate();
  const [loadingStudentId, setLoadingStudentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openRecommendations = useCallback(
    async (student: StudentLike) => {
      setError(null);
      setLoadingStudentId(student.student_id);
      try {
        const { preview_token, student_id, student_name, expires_in_minutes } =
          await requestPreviewToken(student.student_id);
        // token 只透過 router state 傳，不進 localStorage、不碰共用的 authToken
        // —— 見 StudentPreviewPage.tsx 的說明。
        navigate(`/teacher/preview/${student_id}`, {
          state: {
            previewToken: preview_token,
            studentId: student_id,
            studentName: student_name,
            expiresInMinutes: expires_in_minutes,
          },
        });
      } catch {
        setError('無法開啟推薦練習，請稍後再試');
      } finally {
        setLoadingStudentId(null);
      }
    },
    [navigate],
  );

  return { openRecommendations, loadingStudentId, error };
}
