import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AbilityBar from '../AbilityBar';

const descriptions = ['排除一個選項', '本題多五秒', '擋住一次迷霧'];

describe('AbilityBar', () => {
  it('救援彈窗期間保留未使用能力卡的說明，但停用按鈕', () => {
    render(<AbilityBar used={[]} disabled onUse={() => {}} />);

    for (const description of descriptions) {
      expect(screen.getByText(description)).toBeInTheDocument();
    }
    expect(screen.queryByText('已使用')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提示卡，排除一個選項' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '延時卡，本題多五秒' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '護字符，擋住一次迷霧' })).toBeDisabled();
  });

  it('已使用的提示卡顯示已使用並停用，其他能力卡仍可用', () => {
    render(<AbilityBar used={['hint']} disabled={false} onUse={() => {}} />);

    expect(screen.getByText('已使用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提示卡，已使用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '延時卡，本題多五秒' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '護字符，擋住一次迷霧' })).toBeEnabled();
  });

  it('救援彈窗期間只有實際使用過的卡顯示已使用', () => {
    render(<AbilityBar used={['hint']} disabled onUse={() => {}} />);

    expect(screen.getByRole('button', { name: '提示卡，已使用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '延時卡，本題多五秒' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '護字符，擋住一次迷霧' })).toBeDisabled();
    expect(screen.getByText('本題多五秒')).toBeInTheDocument();
    expect(screen.getByText('擋住一次迷霧')).toBeInTheDocument();
  });
});
