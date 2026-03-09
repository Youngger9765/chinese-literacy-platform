/**
 * Google Analytics 4 tracking utility.
 * All functions are no-ops if GA is not loaded or consent not given.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/** Check if GA is available and user has accepted the privacy policy. */
const isGAReady = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (typeof window.gtag !== 'function') return false;
  // Respect privacy consent: must have accepted terms/privacy policy.
  // We store this flag in localStorage when TermsModal is accepted.
  const consented = localStorage.getItem('privacy_consent_accepted');
  return consented === 'true';
};

/** Track a page view. */
export const trackPageView = (path: string): void => {
  if (!isGAReady()) return;
  window.gtag!('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
  });
};

/** Track a generic event. */
export const trackEvent = (
  category: string,
  action: string,
  label?: string,
  value?: number,
): void => {
  if (!isGAReady()) return;
  window.gtag!('event', action, {
    event_category: category,
    event_label: label,
    value,
  });
};

export type LearningEventType =
  | 'start_lesson'
  | 'complete_lesson'
  | 'start_reading'
  | 'complete_reading'
  | 'vocab_practice'
  | 'comprehension_complete';

/** Track a learning-specific event with metadata. */
export const trackLearningEvent = (
  event: LearningEventType,
  metadata: Record<string, string | number>,
): void => {
  if (!isGAReady()) return;
  window.gtag!('event', event, {
    event_category: 'learning',
    ...metadata,
  });
};
