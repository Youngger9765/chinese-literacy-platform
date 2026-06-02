/**
 * useWriteCharacterMachine — issue #1858
 *
 * Owns step / mode / practiceLeft state transitions for WriteCharacter.
 * Pure step-machine logic; no canvas, no refs, no animation.
 */

import { useState, useCallback } from 'react';

export enum Step {
  ANIMATION,
  PRACTICE_1,
  PRACTICE_2,
  PRACTICE_3,
  PRACTICE_NO_OUTLINE,
  COMPLETE,
}

export type Mode = 'idle' | 'animating' | 'quizzing';

export interface WriteCharacterMachineState {
  step: Step;
  mode: Mode;
  practiceLeft: number;
  showOutline: boolean;
  completedStrokesUI: number;
  toast: string;
  toastType: 'success' | 'error' | 'info';
  canvasShake: boolean;
}

export interface WriteCharacterMachineActions {
  setStep: (s: Step) => void;
  setMode: (m: Mode) => void;
  setPracticeLeft: (n: number) => void;
  setShowOutline: (v: boolean) => void;
  setCompletedStrokesUI: (n: number) => void;
  setToast: (msg: string) => void;
  setToastType: (t: 'success' | 'error' | 'info') => void;
  setCanvasShake: (v: boolean) => void;
  /** Apply the per-practiceMode initial state. */
  resetMachineState: (opts: { nStrokes: number; isOutlinedOnce: boolean; isNoOutlineOnce: boolean }) => InitialMachineResult;
}

export interface InitialMachineResult {
  initialStep: Step;
  outlineOn: boolean;
  leftCount: number;
}

export function useWriteCharacterMachine(): [WriteCharacterMachineState, WriteCharacterMachineActions] {
  const [step, setStep] = useState<Step>(Step.ANIMATION);
  const [mode, setMode] = useState<Mode>('idle');
  const [practiceLeft, setPracticeLeft] = useState(4);
  const [showOutline, setShowOutline] = useState(true);
  const [completedStrokesUI, setCompletedStrokesUI] = useState(0);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');
  const [canvasShake, setCanvasShake] = useState(false);

  const resetMachineState = useCallback(
    (opts: { nStrokes: number; isOutlinedOnce: boolean; isNoOutlineOnce: boolean }): InitialMachineResult => {
      const { isOutlinedOnce, isNoOutlineOnce } = opts;
      let initialStep = Step.ANIMATION;
      let outlineOn = true;
      let leftCount = 4;
      if (isOutlinedOnce) {
        leftCount = 1;
      } else if (isNoOutlineOnce) {
        initialStep = Step.PRACTICE_NO_OUTLINE;
        outlineOn = false;
        leftCount = 1;
      }
      setStep(initialStep);
      setMode('idle');
      setPracticeLeft(leftCount);
      setShowOutline(outlineOn);
      setToast('');
      setCompletedStrokesUI(0);
      return { initialStep, outlineOn, leftCount };
    },
    [],
  );

  const state: WriteCharacterMachineState = {
    step,
    mode,
    practiceLeft,
    showOutline,
    completedStrokesUI,
    toast,
    toastType,
    canvasShake,
  };

  const actions: WriteCharacterMachineActions = {
    setStep,
    setMode,
    setPracticeLeft,
    setShowOutline,
    setCompletedStrokesUI,
    setToast,
    setToastType,
    setCanvasShake,
    resetMachineState,
  };

  return [state, actions];
}
