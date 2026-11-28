/**
 * #4154 作答後回饋（真正的線上路徑：ComprehensionMcqPage → LessonRenderer → ExerciseBlockView）
 *
 * 規則（不推翻既有設計）：
 *  - 答錯：只告訴孩子「你選的這個為什麼不對」，不公布正解（2026-08-19 Young：答案不能在學生答對前到得了）
 *  - 答對：四個選項各一句說明
 *  - 看原文依據：答錯答對都有（指回課文，不點名答案）
 *  - 這題怪怪的：沿用意見回報，標題帶課號與題號
 *  - 沒有說明資料：畫面維持現狀，不留空白區塊
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useState } from 'react';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../services/feedbackApi', () => ({
  submitFeedback: vi.fn(async () => ({ id: 1 })),
}));

import ExerciseBlockView from '../ExerciseBlockView';
import { submitFeedback } from '../../../services/feedbackApi';

const PARA = '第一句在前。小戴一得分，大家歡天喜地。不幸鷹眼判定出界，大家唉聲嘆氣、捶胸頓足。最後一句。';
const EVIDENCE = '不幸鷹眼判定出界，大家唉聲嘆氣、捶胸頓足';

function makeExercise(withFeedback: boolean) {
  return {
    id: 'ex-mcq-2',
    kind: 'exercise' as const,
    type: 'exercise' as const,
    answerSpace: 'choice' as const,
    grader: 'exact' as const,
    answer: 1,
    question: {
      kind: 'multiple_choice' as const,
      question: '「捶胸頓足」最可能的情緒是？',
      options: ['開心', '懊惱', '欣喜', '寂寞'],
      explanation: '舊的單一說明',
      ...(withFeedback
        ? {
            option_explanations: [
              '不適合：A說明-開心',
              '正確：B說明-懊惱',
              '不適合：C說明-欣喜',
              '不適合：D說明-寂寞',
            ],
            evidence_sentence: EVIDENCE,
            evidence_paragraph: PARA,
          }
        : {}),
    },
  };
}

/** 外殼：模擬 LessonRenderer 持有 value / verdict 的方式 */
function Harness({ withFeedback }: { withFeedback: boolean }) {
  const [value, setValue] = useState<unknown>(null);
  const [verdict, setVerdict] = useState<boolean | null | undefined>(undefined);
  return (
    <ExerciseBlockView
      exercise={makeExercise(withFeedback) as never}
      lessonCode="L0011"
      value={value}
      verdict={verdict}
      onValueChange={setValue}
      onGraded={(r) => setVerdict(r.verdict)}
    />
  );
}

const pick = (text: string) => fireEvent.click(screen.getByRole('radio', { name: new RegExp(text) }));

describe('#4154 答錯：只說被選的那個為什麼不對', () => {
  beforeEach(() => vi.clearAllMocks());

  it('被選項那句說明在，其他三句與「正確」字樣都不在', () => {
    render(<Harness withFeedback />);
    pick('開心');
    expect(screen.getByText(/A說明-開心/)).toBeTruthy();
    expect(screen.queryByText(/B說明-懊惱/)).toBeNull();
    expect(screen.queryByText(/C說明-欣喜/)).toBeNull();
    expect(screen.queryByText(/D說明-寂寞/)).toBeNull();
    expect(screen.getByText('再想想看')).toBeTruthy();
  });

  it('再試一次之後說明收起來，可以重選', () => {
    render(<Harness withFeedback />);
    pick('開心');
    fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
    expect(screen.queryByText(/A說明-開心/)).toBeNull();
    pick('懊惱');
    expect(screen.getByText(/B說明-懊惱/)).toBeTruthy();
  });
});

describe('#4154 答對：四個選項各一句', () => {
  it('四句都在，正解那句有「正確」', () => {
    render(<Harness withFeedback />);
    pick('懊惱');
    for (const k of ['A說明-開心', 'B說明-懊惱', 'C說明-欣喜', 'D說明-寂寞']) {
      expect(screen.getByText(new RegExp(k))).toBeTruthy();
    }
    expect(screen.getByText('✓ 答對了')).toBeTruthy();
  });
});

describe('#4154 看原文依據', () => {
  it('答錯、答對都有；打開後整段在、依據句用 mark', () => {
    render(<Harness withFeedback />);
    pick('開心');
    fireEvent.click(screen.getByRole('button', { name: /看原文依據/ }));
    const dlg = screen.getByRole('dialog');
    expect(dlg.querySelector('mark')?.textContent).toBe(EVIDENCE);
    expect(dlg.textContent).toContain('第一句在前。');
    expect(dlg.textContent).toContain('最後一句。');
    fireEvent.click(within(dlg).getByRole('button', { name: /關閉/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('還沒作答不出現', () => {
    render(<Harness withFeedback />);
    expect(screen.queryByRole('button', { name: /看原文依據/ })).toBeNull();
  });
});

describe('#4154 這題怪怪的', () => {
  it('標題帶課號與題號（ex-mcq-2 → 第 2 題）', () => {
    render(<Harness withFeedback />);
    pick('懊惱');
    fireEvent.click(screen.getByRole('button', { name: /這題怪怪的/ }));
    expect(submitFeedback).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(submitFeedback).mock.calls[0][0];
    expect(arg.title).toContain('L0011');
    expect(arg.title).toContain('第 2 題');
    expect(arg.category).toBe('bug');
  });

  it('按過之後不會重複送', () => {
    render(<Harness withFeedback />);
    pick('懊惱');
    fireEvent.click(screen.getByRole('button', { name: /這題怪怪的/ }));
    expect(screen.queryByRole('button', { name: /^這題怪怪的/ })).toBeNull();
    expect(screen.getByText(/已回報/)).toBeTruthy();
  });
});

describe('#4154 沒有說明資料的題目維持現狀', () => {
  it('答對：沒有任何新增的按鈕與說明', () => {
    render(<Harness withFeedback={false} />);
    pick('懊惱');
    expect(screen.getByText('✓ 答對了')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /看原文依據/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /這題怪怪的/ })).toBeNull();
    expect(screen.queryByText(/說明-/)).toBeNull();
  });

  it('答錯：只有「再想想看」與再試一次', () => {
    render(<Harness withFeedback={false} />);
    pick('開心');
    expect(screen.getByText('再想想看')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /看原文依據/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /這題怪怪的/ })).toBeNull();
  });
});
