/**
 * issue #3607 — ClassroomPkSettingsPanel extended from one switch (真人 PK)
 * to three (真人 PK / 跨班賽季 / 課堂搶答). Each switch must only PATCH its
 * own key — a teacher toggling 跨班賽季 must never accidentally send stale
 * values for the other two switches (merge-not-overwrite is the backend's
 * job; the frontend's job is to never send a key it isn't actually toggling).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ClassroomPkSettingsPanel from '../ClassroomPkSettingsPanel';
import * as classroomApi from '../../../services/classroomApi';

describe('ClassroomPkSettingsPanel — three switches (#3607)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all three switches with their current state', () => {
    render(
      <ClassroomPkSettingsPanel
        token="t"
        classroomId={1}
        pkHuman={true}
        league={false}
        liveQuiz={false}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole('switch', { name: '真人 PK 開關' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: '跨班賽季開關' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: '課堂搶答開關' })).toHaveAttribute('aria-checked', 'false');
  });

  it('toggling 跨班賽季 only sends {league: true} — not the other two keys', async () => {
    const spy = vi
      .spyOn(classroomApi, 'updateClassroomFeatureSettings')
      .mockResolvedValue({ pk_human: true, league: true, live_quiz: false });
    const onChanged = vi.fn();

    render(
      <ClassroomPkSettingsPanel
        token="t"
        classroomId={7}
        pkHuman={true}
        league={false}
        liveQuiz={false}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: '跨班賽季開關' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('t', 7, { league: true });
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ pk_human: true, league: true, live_quiz: false }));
  });

  it('toggling 課堂搶答 off only sends {live_quiz: false}', async () => {
    const spy = vi
      .spyOn(classroomApi, 'updateClassroomFeatureSettings')
      .mockResolvedValue({ pk_human: false, league: false, live_quiz: false });

    render(
      <ClassroomPkSettingsPanel
        token="t"
        classroomId={3}
        pkHuman={false}
        league={false}
        liveQuiz={true}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: '課堂搶答開關' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('t', 3, { live_quiz: false }));
  });

  it('shows an error message and does not call onChanged when the API call fails', async () => {
    vi.spyOn(classroomApi, 'updateClassroomFeatureSettings').mockRejectedValue(
      new classroomApi.ClassroomApiError('老師還沒開放跨班賽季', 403),
    );
    const onChanged = vi.fn();

    render(
      <ClassroomPkSettingsPanel
        token="t"
        classroomId={9}
        pkHuman={false}
        league={false}
        liveQuiz={false}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: '跨班賽季開關' }));

    expect(await screen.findByText('老師還沒開放跨班賽季')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
