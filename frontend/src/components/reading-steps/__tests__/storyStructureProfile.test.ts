import { describe, expect, it } from 'vitest';
import {
  buildDemoSequence,
  deriveStructureProfile,
  getCoachIntroText,
} from '../storyStructureProfile';

describe('deriveStructureProfile', () => {
  it('uses API interaction_profile when present', () => {
    const profile = deriveStructureProfile({
      layout: 'worksheet_table',
      rows: [],
      interaction_profile: {
        mode: 'fill_blank',
        template_kind: 'psr',
        fill_blank_count: 3,
        checkbox_count: 0,
        primary_labels: ['問題'],
        layout: 'worksheet_table',
      },
    });
    expect(profile.mode).toBe('fill_blank');
    expect(profile.template_kind).toBe('psr');
  });

  it('derives checkbox mode from rows', () => {
    const profile = deriveStructureProfile({
      rows: [
        {
          label: '❷ 假說',
          value: '選項',
          interactive_type: 'checkbox',
        },
      ],
    });
    expect(profile.mode).toBe('checkbox');
    expect(profile.checkbox_count).toBe(1);
  });

  it('derives mixed mode', () => {
    const profile = deriveStructureProfile({
      rows: [
        { label: '主題', value: 'x', interactive_type: 'fill_blank' },
        { label: '事實', value: 'y', interactive_type: 'checkbox' },
      ],
    });
    expect(profile.mode).toBe('mixed');
  });
});

describe('buildDemoSequence', () => {
  it('skips interact step for display_only', () => {
    const steps = buildDemoSequence({
      mode: 'display_only',
      template_kind: 'generic',
      fill_blank_count: 0,
      checkbox_count: 0,
      primary_labels: [],
      layout: 'cards',
    });
    expect(steps.map((s) => s.id)).not.toContain('interact');
  });

  it('includes interact for fill_blank', () => {
    const steps = buildDemoSequence({
      mode: 'fill_blank',
      template_kind: 'psr',
      fill_blank_count: 2,
      checkbox_count: 0,
      primary_labels: ['問題'],
      layout: 'worksheet_table',
    });
    expect(steps.map((s) => s.id)).toContain('interact');
  });
});

describe('getCoachIntroText', () => {
  it('mentions checkbox for checkbox mode', () => {
    const text = getCoachIntroText({
      mode: 'checkbox',
      template_kind: 'scientific',
      fill_blank_count: 0,
      checkbox_count: 2,
      primary_labels: [],
      layout: 'worksheet_table',
    });
    expect(text).toMatch(/勾選|選項/);
  });
});
