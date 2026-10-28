/**
 * At 390px the idle 重點朗讀 bar put the speed picker beside two flex-1
 * buttons; flex-1 never wraps, so 開始朗讀 was squeezed past the right edge
 * and its label went vertical. The speed labels (稍慢／正常) did the same on
 * 全文標記. jsdom has no layout, so this locks the classes that prevent it.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TtsSpeedPicker from '../TtsSpeedPicker';
import KeyPassageReadingControls from '../key-passage-reading/KeyPassageReadingControls';

const noop = vi.fn();

describe('phone control bar', () => {
  it('speed labels never break inside a word and the picker never shrinks', () => {
    render(<TtsSpeedPicker />);
    const group = screen.getByRole('group', { name: '朗讀速度' });
    expect(group.className).toMatch(/\bshrink-0\b/);
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/\bwhitespace-nowrap\b/);
  });

  it('the compact size used on 讀全文-做記號 (#3397) keeps the same guards', () => {
    render(<TtsSpeedPicker size="sm" />);
    const group = screen.getByRole('group', { name: '朗讀速度' });
    expect(group.className).toMatch(/\bshrink-0\b/);
    for (const b of screen.getAllByRole('button')) {
      expect(b.className).toMatch(/\bwhitespace-nowrap\b/);
      expect(b.className).toMatch(/\bh-7\b/);
    }
  });

  it('idle 重點朗讀: picker takes its own row on phones, buttons keep one line', () => {
    render(
      <KeyPassageReadingControls
        state="idle" onSpeak={noop} onStartSession={noop} onSubmit={noop} onCancel={noop}
        onStopTts={noop} onPauseTts={noop} onResumeTts={noop} onRetry={noop} onFinish={noop}
        isTtsPaused={false} sessionTranscriptReady={false} inToolbox={false} recordingSecs={0}
      />,
    );
    const group = screen.getByRole('group', { name: '朗讀速度' });
    expect(group.className).toMatch(/(^|\s)w-full(\s|$)/);
    expect(group.className).toMatch(/\bsm:w-auto\b/);
    expect(screen.getByRole('button', { name: /開始朗讀/ }).className).toMatch(/\bwhitespace-nowrap\b/);
    expect(screen.getByRole('button', { name: /AI 朗讀/ }).className).toMatch(/\bwhitespace-nowrap\b/);
  });
});
