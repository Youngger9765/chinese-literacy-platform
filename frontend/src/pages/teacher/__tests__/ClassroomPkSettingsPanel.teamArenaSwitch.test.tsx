/**
 * issue #3632 — ClassroomPkSettingsPanel extended from three switches to
 * four (真人 PK / 跨班賽季 / 課堂搶答 / 五人對抗賽). Same rule as #3607's
 * three-switch suite: toggling 五人對抗賽 must only PATCH {team_arena: ...},
 * never resend the other three keys' current values.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ClassroomPkSettingsPanel from '../ClassroomPkSettingsPanel';
import * as classroomApi from '../../../services/classroomApi';

describe('ClassroomPkSettingsPanel — 五人對抗賽 switch (#3632)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the 五人對抗賽 switch, defaulting to off when the prop is omitted', () => {
    render(
      <ClassroomPkSettingsPanel
        token="t"
        classroomId={1}
        pkHuman={false}
        league={false}
        liveQuiz={false}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole('switch', { name: '五人對抗賽開關' })).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects teamArena={true} when passed', () => {
    render(
      <ClassroomPkSettingsPanel
        token="t"
        classroomId={1}
        pkHuman={false}
        league={false}
        liveQuiz={false}
        teamArena={true}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole('switch', { name: '五人對抗賽開關' })).toHaveAttribute('aria-checked', 'true');
  });

  it('toggling 五人對抗賽 only sends {team_arena: true} — not the other three keys', async () => {
    const spy = vi
      .spyOn(classroomApi, 'updateClassroomFeatureSettings')
      .mockResolvedValue({ pk_human: true, league: false, live_quiz: false, team_arena: true });
    const onChanged = vi.fn();

    render(
      <ClassroomPkSettingsPanel
        token="t"
        classroomId={7}
        pkHuman={true}
        league={false}
        liveQuiz={false}
        teamArena={false}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: '五人對抗賽開關' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('t', 7, { team_arena: true });
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith({ pk_human: true, league: false, live_quiz: false, team_arena: true }),
    );
  });
});
