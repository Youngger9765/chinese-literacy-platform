import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  getCrossTextAnalysis,
  ClassroomCrossTextPattern,
  TeacherApiError,
} from '../../../services/teacherApi';

interface UseCrossTextDataResult {
  data: ClassroomCrossTextPattern | null;
  isLoading: boolean;
  error: string;
  reload: () => void;
}

export function useCrossTextData(classroomId: number): UseCrossTextDataResult {
  const { token } = useAuth();
  const [data, setData] = useState<ClassroomCrossTextPattern | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const result = await getCrossTextAnalysis(token, classroomId);
      setData(result);
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setError(err.message);
      } else {
        setError('無法載入跨課文分析資料');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, classroomId]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, isLoading, error, reload: load };
}
