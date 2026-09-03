// @vitest-environment-options {"url":"https://lingoleap-prod.web.app/junyi-slo-logout"}

import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import JunyiSloLogoutPage, { sloNavigation } from '../JunyiSloLogoutPage';
import { isAllowedSloContinue } from '../../utils/sloParticipants';
import { AUTH_TOKEN_KEY, JUNYI_SESSION_FLAG } from '../../utils/storage';

describe('isAllowedSloContinue (open-redirect allowlist)', () => {
  it.each([
    'https://www.junyiacademy.org/logout/next',
    'https://portal.junyiacademy.org/foo',
    'https://foo.jutor.ai/bar',
    'https://lingoleap-prod.web.app/login',
    'https://lingoleap-staging.web.app/',
    'https://www.shareclass.org/',
    'https://test.shareclass.org/',
    'https://app.active-ai.io/',
    'https://testing.gcp.active-ai.io/',
  ])('accepts allowed participant %s', (url) => {
    expect(isAllowedSloContinue(url)).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['non-https', 'http://www.junyiacademy.org/'],
    ['unknown host', 'https://evil.example/phishing'],
    ['substring lookalike', 'https://eviljutor.ai/x'],
    ['suffix spoof', 'https://jutor.ai.evil.com/x'],
    ['junyi lookalike', 'https://junyiacademy.org.evil.com/x'],
    ['protocol-relative', '//foo.jutor.ai/x'],
    ['garbage', 'not a url'],
  ])('rejects %s continue', (_case, url) => {
    expect(isAllowedSloContinue(url as string | undefined)).toBe(false);
  });
});

describe('JunyiSloLogoutPage', () => {
  let replaceSpy: MockInstance;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    replaceSpy = vi.spyOn(sloNavigation, 'replace').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  const renderAt = (search: string) =>
    render(
      <MemoryRouter initialEntries={[`/junyi-slo-logout${search}`]}>
        <JunyiSloLogoutPage />
      </MemoryRouter>,
    );

  it('clears the LingoLeap credential and redirects to a valid continue', () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'jwt-123');
    localStorage.setItem(JUNYI_SESSION_FLAG, '1');
    sessionStorage.setItem('activeAssignmentId', 'a1');

    renderAt('?continue=' + encodeURIComponent('https://foo.jutor.ai/next'));

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(JUNYI_SESSION_FLAG)).toBeNull();
    expect(sessionStorage.getItem('activeAssignmentId')).toBeNull();
    expect(replaceSpy).toHaveBeenCalledWith('https://foo.jutor.ai/next');
  });

  it('is idempotent: succeeds and redirects even when already logged out', () => {
    renderAt('?continue=' + encodeURIComponent('https://www.junyiacademy.org/x'));
    expect(replaceSpy).toHaveBeenCalledWith('https://www.junyiacademy.org/x');
  });

  it('falls back to /login on missing continue', () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'jwt-123');
    renderAt('');
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(replaceSpy).toHaveBeenCalledWith('https://lingoleap-prod.web.app/login');
  });

  it('falls back to /login on a disallowed continue (open-redirect blocked)', () => {
    renderAt('?continue=' + encodeURIComponent('https://evil.example/phishing'));
    expect(replaceSpy).toHaveBeenCalledWith('https://lingoleap-prod.web.app/login');
  });
});
