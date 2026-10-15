import { describe, it, expect } from 'vitest';
import { stepperEdgeFades } from '../AppShell';

// #3549: on a 390px phone the step row scrolls sideways with the scrollbar
// hidden and nothing says there are more steps off to the right.
describe('stepperEdgeFades (#3549)', () => {
  it('no fades when everything fits', () => {
    expect(stepperEdgeFades(0, 390, 390)).toEqual({ left: false, right: false });
  });
  it('right fade when steps are cut off on the right', () => {
    expect(stepperEdgeFades(0, 300, 520)).toEqual({ left: false, right: true });
  });
  it('both fades mid-scroll, only left at the end', () => {
    expect(stepperEdgeFades(100, 300, 520)).toEqual({ left: true, right: true });
    expect(stepperEdgeFades(220, 300, 520)).toEqual({ left: true, right: false });
  });
  it('tolerates sub-pixel rounding at the end', () => {
    expect(stepperEdgeFades(219.5, 300, 520)).toEqual({ left: true, right: false });
  });
});
