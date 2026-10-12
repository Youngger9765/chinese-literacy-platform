import '@testing-library/jest-dom';

// jsdom does not implement matchMedia. Components that read it at module load
// (e.g. ReadingAnnotation's IS_TOUCH = window.matchMedia('(pointer: coarse)'))
// throw "matchMedia is not a function" and take their whole test suite down.
// Provide a minimal no-op polyfill so those suites can mount. (#2218)
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom does not implement scrollIntoView. Components that call it on mount
// (e.g. AssignmentCreateForm scrolling the lesson-select into view) throw
// "scrollIntoView is not a function" and take their whole test suite down,
// even in suites that never intended to assert on scrolling.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}
