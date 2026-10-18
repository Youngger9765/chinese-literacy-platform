/**
 * ChoiceInput.test.tsx — #3621 regression: picture-answer options.
 *
 * L0052 Q3 / L0143 Q1 ("下列哪一張圖…") have a correct option whose text is
 * blank because the real content is a drawing — `images[i]` carries the
 * asset URL for that index. Before this fix, ChoiceInput had no `images`
 * prop at all, so the Phase-2 LessonRenderer path (LESSON_RENDERER_V1,
 * default ON) rendered the blank-text option with nothing in it, even
 * though the legacy MultipleChoiceExercise path (#3629) already showed the
 * picture.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChoiceInput from '../ChoiceInput';

describe('ChoiceInput image options', () => {
  const options = ['藍鯨骨骼標本', '鯊魚', '藍鯨', ''];
  const images = [null, null, null, 'https://backend.example/assets/lesson/L0052/fig13.jpeg'];

  it('renders the image for the option that carries one, including when its text is blank', () => {
    render(<ChoiceInput options={options} images={images} value={null} onChange={vi.fn()} />);
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('https://backend.example/assets/lesson/L0052/fig13.jpeg');
    // The option button for D must still exist and be clickable even with blank text.
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
  });

  it('renders no images when the `images` prop is absent (plain text-only question)', () => {
    render(<ChoiceInput options={options} value={null} onChange={vi.fn()} />);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
