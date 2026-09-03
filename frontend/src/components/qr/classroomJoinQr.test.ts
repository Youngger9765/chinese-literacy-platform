import { describe, it, expect } from 'vitest';
import { buildClassroomJoinQrValue } from './classroomJoinQr';

describe('buildClassroomJoinQrValue (#3081)', () => {
  it('encodes the /join route with the code as a query param', () => {
    expect(buildClassroomJoinQrValue('https://lingoleap-prod.web.app', 'ABC123'))
      .toBe('https://lingoleap-prod.web.app/join?code=ABC123');
  });

  it('uses whatever origin it is given -- it never reads window.location itself', () => {
    // Regression lock (#3081 AC design decision ②): the whole reason this
    // takes `origin` as a parameter instead of reading `window.location.origin`
    // internally is so a caller swap back to `window.location.origin` shows up
    // as a diff at the call site, not as a silent behavior change buried in
    // here. This test can't catch that swap by itself (see
    // ClassroomJoinQrButton.test.tsx for the call-site lock) but it does prove
    // this function has no implicit origin of its own to fall back to.
    expect(buildClassroomJoinQrValue('https://staging.example.test', 'XYZ999'))
      .toBe('https://staging.example.test/join?code=XYZ999');
  });

  it('percent-encodes the code', () => {
    // join codes are alphanumeric in practice, but the encoding must not
    // silently assume that -- a code containing a URL-meaningful character
    // should not corrupt the query string.
    expect(buildClassroomJoinQrValue('https://x.test', 'A&B=C'))
      .toBe('https://x.test/join?code=A%26B%3DC');
  });
});
