/**
 * useRepeatedErrorAlerts — Issue #248 repeated error alert fetch hook (#1845).
 *
 * Extracted from AssessmentReport.tsx so the fetch logic lives in isolation.
 * Returns alert state and a dismiss callback.
 *
 * Behavior:
 * - Fetches once when token + dbSessionId + hasReadingData are all truthy.
 * - Uses a ref guard (alertFetchedRef) to prevent duplicate fetches on re-render.
 * - Silently ignores errors so the report page is never broken by this non-critical fetch.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getRepeatedErrorsAlert } from '../../services/progressApi';
import type { RepeatedErrorAlertItem } from '../../services/progressApi';

export interface UseRepeatedErrorAlertsResult {
  repeatedAlerts: RepeatedErrorAlertItem[];
  showRepeatedAlert: boolean;
  dismissAlert: () => void;
}

export function useRepeatedErrorAlerts(
  token: string | null | undefined,
  dbSessionId: number | null | undefined,
  hasReadingData: boolean,
): UseRepeatedErrorAlertsResult {
  const [repeatedAlerts, setRepeatedAlerts] = useState<RepeatedErrorAlertItem[]>([]);
  const [showRepeatedAlert, setShowRepeatedAlert] = useState(false);
  const alertFetchedRef = useRef(false);

  const fetchRepeatedAlerts = useCallback(async () => {
    if (!token || !dbSessionId || alertFetchedRef.current || !hasReadingData) return;
    alertFetchedRef.current = true;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const studentId: number | undefined = payload?.user_id ?? payload?.sub;
      if (!studentId) return;
      const data = await getRepeatedErrorsAlert(token, Number(studentId));
      if (data.total > 0) {
        setRepeatedAlerts(data.alerts);
        setShowRepeatedAlert(true);
      }
    } catch {
      // Non-critical: silently ignore errors so the report page still works
    }
  }, [token, dbSessionId, hasReadingData]);

  useEffect(() => {
    fetchRepeatedAlerts();
  }, [fetchRepeatedAlerts]);

  const dismissAlert = useCallback(() => setShowRepeatedAlert(false), []);

  return { repeatedAlerts, showRepeatedAlert, dismissAlert };
}
