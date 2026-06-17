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
