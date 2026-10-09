import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AtRiskStudents from './AtRiskStudents';
import { getAtRiskStudents } from '../../services/teacherApi';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 'test' }) }));
vi.mock('../../services/teacherApi', () => ({ getAtRiskStudents: vi.fn() }));

const students = [
  {
    student_id: 1, student_name: '需要協助', risk_level: 'medium',
    risk_factors: ['前期課文正確率偏低'], recommended_actions: ['安排一對一朗讀指導'],
    confidence_score: 0.5, supporting_data: {},
  },
  {
    student_id: 2, student_name: '尚未練習', risk_level: 'insufficient_data',
    risk_factors: [], recommended_actions: [], confidence_score: 0, supporting_data: {},
  },
  {
    student_id: 3, student_name: '狀態穩定', risk_level: 'low',
    risk_factors: [], recommended_actions: [], confidence_score: 0.5, supporting_data: {},
  },
];

it('shows intervention text and insufficient data by default, and collapses low risk students', async () => {
  vi.mocked(getAtRiskStudents).mockResolvedValue(students as Awaited<ReturnType<typeof getAtRiskStudents>>);
  render(<AtRiskStudents classroomId={9} />);
  expect(await screen.findByText('安排一對一朗讀指導')).toBeVisible();
  expect(screen.getByText('前期課文正確率偏低')).toBeVisible();
  expect(screen.getByText('尚未練習')).toBeVisible();
  expect(screen.getByText('資料不足')).toBeVisible();
  expect(screen.queryByText('狀態穩定')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /低風險/ }));
  expect(screen.getByText('狀態穩定')).toBeVisible();
});
