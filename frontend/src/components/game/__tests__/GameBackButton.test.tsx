/**
 * GameBackButton — #3747: clicking it must navigate to the explicit `to`
 * route (not rely on browser history, which this component's own header
 * comment explains is unpredictable for these entry points).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import GameBackButton from '../GameBackButton';

describe('GameBackButton', () => {
  it('renders the given label and navigates to the given route on click', () => {
    render(
      <MemoryRouter initialEntries={['/pk']}>
        <Routes>
          <Route path="/pk" element={<GameBackButton to="/game-hub" label="遊戲區" />} />
          <Route path="/game-hub" element={<div>遊戲區首頁</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const button = screen.getByRole('button', { name: '返回遊戲區' });
    expect(button).toHaveTextContent('遊戲區');
    fireEvent.click(button);
    expect(screen.getByText('遊戲區首頁')).toBeTruthy();
  });

  it('defaults the label to 遊戲區 when none is given', () => {
    render(
      <MemoryRouter initialEntries={['/live']}>
        <Routes>
          <Route path="/live" element={<GameBackButton to="/game-hub" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: '返回遊戲區' })).toBeTruthy();
  });
});
