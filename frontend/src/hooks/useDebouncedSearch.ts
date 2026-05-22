/**
 * useDebouncedSearch — debounced query string with automatic page reset.
 *
 * Returns the raw query (bound to the input), the debounced query (used
 * for API calls), and the current page index.  Whenever the debounced
 * query changes the page resets to 0.
 *
 * Usage:
 *   const { query, setQuery, debouncedQuery, page, setPage } =
 *     useDebouncedSearch({ delay: 400 });
 *
 *   // Bind query to the input value, use debouncedQuery for API calls.
 */
import { useState, useEffect, useRef } from 'react';

export interface UseDebouncedSearchOptions {
  /** Initial query value. Defaults to ''. */
  initialQuery?: string;
  /** Debounce delay in milliseconds. Defaults to 400. */
  delay?: number;
}

export interface UseDebouncedSearchResult {
  /** Raw query — bind this to the search input. */
  query: string;
  setQuery: (q: string) => void;
  /** Debounced query — use this for API / filter calls. */
  debouncedQuery: string;
  /** Current page index (0-based). Resets to 0 when debouncedQuery changes. */
  page: number;
  setPage: (p: number) => void;
}

export function useDebouncedSearch(
  options: UseDebouncedSearchOptions = {},
): UseDebouncedSearchResult {
  const { initialQuery = '', delay = 400 } = options;

  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [page, setPage] = useState(0);

  // Track whether this is the first render so we don't reset the page
  // immediately on mount (only when the query actually changes).
  const isFirstRender = useRef(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      // Reset page to 0 only on user-driven query changes, not on mount.
      if (!isFirstRender.current) {
        setPage(0);
      }
    }, delay);

    isFirstRender.current = false;

    return () => clearTimeout(timer);
  }, [query, delay]);

  return { query, setQuery, debouncedQuery, page, setPage };
}
