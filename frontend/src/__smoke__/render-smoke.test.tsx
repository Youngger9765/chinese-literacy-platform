/**
 * render-smoke.test.tsx — Gate ① of the frontend render-safety net (#2289)
 *
 * Purpose: mount each of the 12 main step components + ParagraphReadingControls and
 * assert they do NOT throw a TDZ ReferenceError at mount.
 *
 * Scope: this is NOT a functional test. It only guards against mount-time
 * crashes (TDZ / temporal-dead-zone, missing provider, import-order bug).
 * Errors from missing mock data, unresolved async API calls, or empty context
 * values are intentionally swallowed — they are a different risk profile from a
 * TDZ that white-screens the whole page.
 *
 * #2279 postmortem: ParagraphReadingControls declared `const stopPlaybackSync =
 * useCallback(...)` AFTER the useEffect that listed it in deps → TDZ on mount →
 * 逐段朗讀 白屏. tsc + vite build did NOT catch it. This suite would have.
 *
 * This file lives in src/__smoke__/, so all relative imports are one level up
 * from src/ (e.g. ../context/ZhuyinContext, ../components/...).
 */

import React from 'react';
import { describe, it, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';

import type {
  Story,
  ReadingAttempt,
  LearningSession,
  StrategyExercise as StrategyExerciseType,
} from '../types';

// ── Context hooks: stub so components don't throw "must be used within Provider"

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    mustChangePassword: false,
    loginPassword: null,
    needsTermsAcceptance: false,
    hasClassroom: true,
    teacherGatingEnforced: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    clearMustChangePassword: vi.fn(),
    refreshUser: vi.fn(),
    acceptTerms: vi.fn(),
    loginWithGoogle: vi.fn(),
    loginWithJunyi: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinMode: 'none',
    zhuyinReady: true,
    zhuyinActive: false,
    isZhuyinAny: false,
    isZhuyinAll: false,
    isZhuyinNone: true,
    zhuyinEnabled: false,
    setZhuyinMode: vi.fn(),
    setZhuyinEnabled: vi.fn(),
    toggleZhuyin: vi.fn(),
    processZhuyin: (t: string) => t,
    processLines: () => null,
    processLinesSelective: () => null,
  }),
  ZhuyinProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../context/KaraokeContext', () => ({
  useKaraoke: () => ({
    karaokeEnabled: false,
    setKaraokeEnabled: vi.fn(),
    toggleKaraoke: vi.fn(),
  }),
  KaraokeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// react-router-dom (v7): components call useNavigate at module/render level
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'k' }),
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NavLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Component imports (all default exports) ──────────────────────────────────
import Intro from '../components/reading-steps/Intro';
import ReadingAnnotation from '../components/reading-steps/FullTextAnnotate';
import ParagraphReading from '../components/reading-steps/paragraph-reading/ParagraphReading';
import ParagraphReadingControls from '../components/reading-steps/paragraph-reading/ParagraphReadingControls';
import KeyPassageReading from '../components/reading-steps/KeyPassageReading';
import VocabDefinitionMatch from '../components/reading-steps/VocabDefinitionMatch';
import VocabApplication from '../components/reading-steps/VocabApplication';
import StrategyExercise from '../components/reading-steps/StrategyExercise';
import StoryStructureTable from '../components/reading-steps/StoryStructureTable';
import ComprehensionChat from '../components/reading-steps/ComprehensionChat';
import VocabWordSearch from '../components/reading-steps/VocabWordSearch';
import KnowledgeStation from '../components/reading-steps/KnowledgeStation';
import AssessmentReport from '../components/reading-steps/AssessmentReport';
import LessonRenderer from '../components/lesson-content/LessonRenderer';
import StepActionBar from '../components/learning/StepActionBar';
import StepCoachCard, { StepCoachHelpButton } from '../components/learning/StepCoachCard';
import { LessonSchema } from '../schema/lessonContent';
import LoginPage from '../pages/LoginPage';
import GuestReadingPage from '../pages/GuestReadingPage';
import LessonAudioTable from '../pages/admin/lesson-audio/LessonAudioTable';
import KeypointsFollowupQuestions from '../components/reading-steps/KeypointsFollowupQuestions';
import ClassicalText from '../components/reading-steps/ClassicalText';
import ClassicalWordMatching from '../components/reading-steps/ClassicalWordMatching';
import ClassicalSentenceMatching from '../components/reading-steps/ClassicalSentenceMatching';
import ClassicalSelfChallenge from '../components/reading-steps/ClassicalSelfChallenge';

// ── Minimal fixtures ─────────────────────────────────────────────────────────

const MINIMAL_STORY: Story = {
  id: '1',
  title: '測試課文',
  level: '1',
  content: ['這是第一段。', '這是第二段。'],
  paragraphs: ['這是第一段。', '這是第二段。'],
  thumbnail: '',
  category: 'Fable',
  filename: 'smoke-test.yml',
  grade: '4',
  charCount: 10,
  vocabulary: [{ word: '測試', definition: '試驗' }],
};

const MINIMAL_ATTEMPT: ReadingAttempt = {
  storyId: '1',
  accuracy: 0.9,
  fluency: 1.0,
  cpm: 120,
  mispronouncedWords: [],
  transcription: '這是第一段',
  timestamp: Date.now(),
};

const MINIMAL_SESSION: LearningSession = {
  storyId: '1',
  startedAt: Date.now(),
  introCompleted: true,
  readingAttempt: MINIMAL_ATTEMPT,
  comprehensionResult: null,
  vocabResult: null,
  dictationResult: null,
  fullReadingResult: null,
};

const MINIMAL_STRATEGY_EXERCISE: StrategyExerciseType = {
  type: 'ordering',
  strategy_name: '排序策略',
  instruction: '請排序',
  items: [
    { text: '第一步', correct_order: 1 },
    { text: '第二步', correct_order: 2 },
  ],
};

// Minimal fixture-shaped Lesson for LessonRenderer (Phase-2 unified renderer, #2289 net).
// Built + validated through the frozen zod contract so the smoke covers a real Lesson
// (paragraph + one gradable choice exercise), not a hand-waved object.
const MINIMAL_LESSON = LessonSchema.parse({
  id: 'smoke-lesson',
  lessonCode: 'G4-L1',
  title: '煙霧測試課',
  blocks: [
    { id: 'p1', type: 'paragraph', text: '這是一段課文內容。' },
    {
      id: 'ex1',
      type: 'exercise',
      question: { kind: 'multiple_choice', question: '這段在說什麼？', options: ['A 選項', 'B 選項'] },
      answerSpace: 'choice',
      answer: 0,
      grader: 'exact',
      anchors: [{ blockId: 'p1' }],
    },
  ],
});

const LIVE_TUTOR_CONTROLS_PROPS = {
  isSessionActive: false,
  isPreparing: false,
  isTtsLoading: false,
  isTtsSpeaking: false,
  isTtsPaused: false,
  isAdvancing: false,
  isAwaitingGemini: false,
  lastDiffTokens: null,
  retryCount: 0,
  ttsError: null,
  completedCount: 0,
  totalLines: 2,
  onStartSession: vi.fn(),
  onFinishRecording: vi.fn(),
  onConfirmEvaluate: vi.fn(),
  onConfirmRerecord: vi.fn(),
  onConfirmCancel: vi.fn(),
  onSpeakCurrentParagraph: vi.fn(),
  onPauseResumeTts: vi.fn(),
  onStopTts: vi.fn(),
  onFinish: vi.fn(),
};

/**
 * Mount `el` and fail ONLY on a TDZ-style ReferenceError. Any other thrown
 * error (data shape, async API) is swallowed — those are not the risk this net
 * exists to catch.
 */
function mountGuard(name: string, el: React.ReactElement): void {
  let threw: unknown = null;
  try {
    render(el);
  } catch (e) {
    threw = e;
  }
  if (threw instanceof ReferenceError) {
    throw new Error(`TDZ / ReferenceError on mount of ${name}: ${threw.message}`);
  }
}

// ── Global browser-API polyfills (jsdom gaps) ────────────────────────────────

beforeAll(() => {
  // MediaRecorder
  global.MediaRecorder = class {
    state = 'inactive';
    start() {}
    stop() {}
    pause() {}
    resume() {}
    requestData() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }
    static isTypeSupported() {
      return true;
    }
  } as unknown as typeof MediaRecorder;

  // AudioContext (+ webkit alias)
  const FakeAudioContext = class {
    state = 'running';
    createAnalyser() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        fftSize: 256,
        frequencyBinCount: 128,
        getByteFrequencyData: vi.fn(),
        getByteTimeDomainData: vi.fn(),
      };
    }
    createMediaStreamSource() {
      return { connect: vi.fn(), disconnect: vi.fn() };
    }
    close() {
      return Promise.resolve();
    }
    resume() {
      return Promise.resolve();
    }
  } as unknown as typeof AudioContext;
  global.AudioContext = FakeAudioContext;
  (global as Record<string, unknown>).webkitAudioContext = FakeAudioContext;

  // getUserMedia
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    writable: true,
    configurable: true,
  });

  // SpeechRecognition — absent (mirror browsers without it)
  (global as Record<string, unknown>).SpeechRecognition = undefined;
  (global as Record<string, unknown>).webkitSpeechRecognition = undefined;

  // speechSynthesis (Intro reads it)
  Object.defineProperty(global.window, 'speechSynthesis', {
    value: {
      getVoices: () => [],
      cancel: vi.fn(),
      speak: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    },
    writable: true,
    configurable: true,
  });

  // scrollIntoView (jsdom no-op)
  HTMLElement.prototype.scrollIntoView = vi.fn();

  // IntersectionObserver / ResizeObserver (jsdom gaps)
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;

  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// ── Smoke tests ──────────────────────────────────────────────────────────────

describe('render-smoke: 12 step components mount without TDZ ReferenceError (#2289)', () => {
  it('Intro', () => {
    mountGuard('Intro', <Intro story={MINIMAL_STORY} onStartReading={vi.fn()} onBack={vi.fn()} />);
  });

  // #2752 Phase 2: goal_box feeds the 本課學習策略 box, 70/175 lessons.
  it('Intro (with goal_box)', () => {
    mountGuard(
      'Intro-goalBox',
      <Intro
        story={{ ...MINIMAL_STORY, goalBox: { title: '閱讀之旅的起點', strategy_line: '目標策略：讀出故事道理' } }}
        onStartReading={vi.fn()}
        onBack={vi.fn()}
      />,
    );
  });

  it('ReadingAnnotation', () => {
    mountGuard('ReadingAnnotation', <ReadingAnnotation story={MINIMAL_STORY} onFinish={vi.fn()} />);
  });

  // #2752 Phase 2: a distinct render path (selfCheckBeforeReading banner), 58/175 lessons.
  it('ReadingAnnotation (with self_check_before_reading)', () => {
    mountGuard(
      'ReadingAnnotation-selfCheck',
      <ReadingAnnotation
        story={{ ...MINIMAL_STORY, selfCheckBeforeReading: { items: ['請在不太了解的字、詞或句做記號。'] } }}
        onFinish={vi.fn()}
      />,
    );
  });

  // #2752 Phase 3: multi_text_parts + cross_text_banner + 閱讀接力, 4/175 lessons.
  it('ReadingAnnotation (with multi_text_parts, cross_text_banner, 閱讀接力)', () => {
    mountGuard(
      'ReadingAnnotation-multiText',
      <ReadingAnnotation
        story={{
          ...MINIMAL_STORY,
          multiTextParts: [{ lesson_heading: '第23課', body: { paragraphs: [{ idx: 1, text: '段落一' }] } }],
          crossTextBanner: { title_block: { title: '跨課文習作' } },
          keypointsFollowupQuestions: {
            items: [{ type: 'single', label: '❶', prompt: '哪一項最完整？', options: { '1': 'a' }, answer: 1 }],
          },
        }}
        onFinish={vi.fn()}
      />,
    );
  });

  it('ParagraphReading', () => {
    mountGuard(
      'ParagraphReading',
      <ParagraphReading
        story={MINIMAL_STORY}
        rightPanelWidth={400}
        onPanelWidthChange={vi.fn()}
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
  });

  it('KeyPassageReading', () => {
    mountGuard('KeyPassageReading', <KeyPassageReading story={MINIMAL_STORY} onFinish={vi.fn()} onBack={vi.fn()} />);
  });

  // #2559: 重點朗讀 — exercise the keyReading.passage branch (readingContent = [passage]),
  // not just the full-text fallback, so the pilot code path is smoke-covered.
  it('KeyPassageReading (重點朗讀 keyReading passage)', () => {
    const storyWithKeyReading: Story = {
      ...MINIMAL_STORY,
      keyReading: { passage: '這是老師指定的重點段落，只練這一段。', extentChars: 18, source: 'docx-extract' },
    };
    mountGuard(
      'KeyPassageReading-keyReading',
      <KeyPassageReading story={storyWithKeyReading} onFinish={vi.fn()} onBack={vi.fn()} />,
    );
  });

  it('VocabDefinitionMatch', () => {
    mountGuard('VocabDefinitionMatch', <VocabDefinitionMatch story={MINIMAL_STORY} onFinish={vi.fn()} />);
  });

  it('VocabApplication', () => {
    mountGuard('VocabApplication', <VocabApplication story={MINIMAL_STORY} onFinish={vi.fn()} />);
  });

  it('StrategyExercise', () => {
    mountGuard('StrategyExercise', <StrategyExercise exercise={MINIMAL_STRATEGY_EXERCISE} lessonId="1" />);
  });

  it('StoryStructureTable', () => {
    mountGuard('StoryStructureTable', <StoryStructureTable storyId="1" />);
  });

  // #2752 Phase 3: L0063-shape keypointsFollowupQuestions, 2/175 lessons.
  it('KeypointsFollowupQuestions', () => {
    mountGuard(
      'KeypointsFollowupQuestions',
      <KeypointsFollowupQuestions questions={[{ answer: 'A', stem: '題目一', options: { A: '選項一' } }]} />,
    );
  });

  it('ComprehensionChat', () => {
    mountGuard(
      'ComprehensionChat',
      <ComprehensionChat story={MINIMAL_STORY} attempt={MINIMAL_ATTEMPT} onFinish={vi.fn()} onBack={vi.fn()} />,
    );
  });

  it('VocabWordSearch', () => {
    mountGuard('VocabWordSearch', <VocabWordSearch story={MINIMAL_STORY} onFinish={vi.fn()} />);
  });

  // #2752 Phase 3: writing_practice appended section, 4/175 lessons.
  it('VocabWordSearch (with writing_practice)', () => {
    mountGuard(
      'VocabWordSearch-writingPractice',
      <VocabWordSearch
        story={{ ...MINIMAL_STORY, writingPractice: { words: ['顫顫巍巍', '尷尬'] } }}
        onFinish={vi.fn()}
      />,
    );
  });

  it('KnowledgeStation', () => {
    mountGuard('KnowledgeStation', <KnowledgeStation story={MINIMAL_STORY} onFinish={vi.fn()} />);
  });

  it('AssessmentReport', () => {
    mountGuard('AssessmentReport', <AssessmentReport session={MINIMAL_SESSION} onRetry={vi.fn()} />);
  });

  // 文言文專屬 steps (#2752). Mounted both with and without their data present —
  // the empty-state branch is a distinct render path from the content branch.
  it('ClassicalText (empty state)', () => {
    mountGuard('ClassicalText-empty', <ClassicalText story={MINIMAL_STORY} onFinish={vi.fn()} />);
  });
  it('ClassicalText (with content)', () => {
    mountGuard(
      'ClassicalText-content',
      <ClassicalText
        story={{ ...MINIMAL_STORY, classicalText: { paragraphs: ['桓公曰'] } }}
        onFinish={vi.fn()}
      />,
    );
  });
  it('ClassicalWordMatching', () => {
    mountGuard('ClassicalWordMatching', <ClassicalWordMatching story={MINIMAL_STORY} onFinish={vi.fn()} />);
  });
  it('ClassicalSentenceMatching', () => {
    mountGuard('ClassicalSentenceMatching', <ClassicalSentenceMatching story={MINIMAL_STORY} onFinish={vi.fn()} />);
  });
  it('ClassicalSelfChallenge', () => {
    mountGuard('ClassicalSelfChallenge', <ClassicalSelfChallenge story={MINIMAL_STORY} onFinish={vi.fn()} />);
  });
});

describe('render-smoke: ParagraphReadingControls — TDZ guard for stopPlaybackSync (#2279)', () => {
  it('ParagraphReadingControls', () => {
    mountGuard('ParagraphReadingControls', <ParagraphReadingControls {...LIVE_TUTOR_CONTROLS_PROPS} />);
  });
});

describe('render-smoke: LessonRenderer — Phase-2 unified block renderer (#2289 net)', () => {
  it('LessonRenderer', () => {
    mountGuard('LessonRenderer', <LessonRenderer lesson={MINIMAL_LESSON} lessonCode="G4-L1" />);
  });
});

// LoginPage is the only React (src/) component this session touched — #2410 added
// the quick-login handler. The testset upload UI is static public/ HTML (verified
// via real-browser e2e, not vitest-testable). This locks LoginPage against a
// #2279-style mount/TDZ crash.
describe('render-smoke: LoginPage — quick-login handler mounts without TDZ (#2410)', () => {
  it('LoginPage', () => {
    mountGuard('LoginPage', <LoginPage onSwitchToRegister={vi.fn()} />);
  });
});

describe('render-smoke: 自學模式共用外框（#2897）', () => {
  it('StepActionBar', () => {
    mountGuard(
      'StepActionBar',
      <StepActionBar layout="stack">
        <button type="button">下一關</button>
      </StepActionBar>,
    );
  });

  it('StepCoachCard', () => {
    mountGuard(
      'StepCoachCard',
      <StepCoachCard title="語詞應用怎麼玩？" onDemo={vi.fn()} onDismiss={vi.fn()}>
        讀句子，從下面選出最適合填進空格的語詞。
      </StepCoachCard>,
    );
  });

  it('StepCoachHelpButton', () => {
    mountGuard('StepCoachHelpButton', <StepCoachHelpButton onClick={vi.fn()} />);
  });
});

describe('render-smoke: LessonAudioTable — admin audio table mounts without TDZ (#2622)', () => {
  it('LessonAudioTable', () => {
    mountGuard('LessonAudioTable', <LessonAudioTable />);
  });

  it('GuestReadingPage', () => {
    // Replaces the DemoReadingPage case: that page was the second audio source
    // for 讀全文-做記號 and is gone. This is the page an anonymous QR visitor
    // now lands on.
    mountGuard('GuestReadingPage', <GuestReadingPage />);
  });
});
