/**
 * useGradeForm — state hook for per-submission grading (Issue #1936).
 *
 * Extracted from AssignmentDetailPanel.tsx.
 * Manages: which submission is being graded, score/feedback inputs, saving state, error message.
 */
import { useState, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  gradeSubmission,
  AssignmentApiError,
} from '../../../services/assignmentApi';
import type { SubmissionResponse } from '../../../services/assignmentApi';
import { validateScore, buildGradeClickState } from '../assignmentDetailLogic';

export interface UseGradeFormReturn {
  gradingId: number | null;
  gradeInput: Record<number, string>;
  feedbackInput: Record<number, string>;
  savingId: number | null;
  gradeError: string;
  handleGradeClick: (sub: SubmissionResponse) => void;
  handleSaveGrade: (sub: SubmissionResponse, assignmentId: number, onGraded: (updated: SubmissionResponse) => void) => Promise<void>;
  cancelGrade: () => void;
  setGradeInput: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  setFeedbackInput: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  clearGradeError: () => void;
}

import type React from 'react';

export function useGradeForm(): UseGradeFormReturn {
  const { token } = useAuth();
  const [gradingId, setGradingId] = useState<number | null>(null);
  const [gradeInput, setGradeInput] = useState<Record<number, string>>({});
  const [feedbackInput, setFeedbackInput] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [gradeError, setGradeError] = useState('');

  const handleGradeClick = useCallback((sub: SubmissionResponse) => {
    setGradingId(sub.id);
    const { gradeInput: gi, feedbackInput: fi } = buildGradeClickState(sub);
    setGradeInput((prev) => ({ ...prev, [sub.id]: gi }));
    setFeedbackInput((prev) => ({ ...prev, [sub.id]: fi }));
    setGradeError('');
  }, []);

  const cancelGrade = useCallback(() => {
    setGradingId(null);
    setGradeError('');
  }, []);

  const clearGradeError = useCallback(() => setGradeError(''), []);

  const handleSaveGrade = useCallback(
    async (
      sub: SubmissionResponse,
      assignmentId: number,
      onGraded: (updated: SubmissionResponse) => void,
    ) => {
      if (!token) return;
      const raw = gradeInput[sub.id] ?? '';
      const validationError = validateScore(raw);
      if (validationError) {
        setGradeError(validationError);
        return;
      }

      const score = raw.trim() === '' ? null : parseFloat(raw);
      const feedback = feedbackInput[sub.id]?.trim() || null;

      setSavingId(sub.id);
      setGradeError('');
      try {
        const updated = await gradeSubmission(token, assignmentId, sub.id, score, feedback);
        setGradingId(null);
        onGraded(updated);
      } catch (err) {
        if (err instanceof AssignmentApiError) {
          setGradeError(err.message);
        } else {
          setGradeError('批改失敗，請重試');
        }
      } finally {
        setSavingId(null);
      }
    },
    [token, gradeInput, feedbackInput],
  );

  return {
    gradingId,
    gradeInput,
    feedbackInput,
    savingId,
    gradeError,
    handleGradeClick,
    handleSaveGrade,
    cancelGrade,
    setGradeInput,
    setFeedbackInput,
    clearGradeError,
  };
}
