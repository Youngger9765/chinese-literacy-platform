/**
 * annotationReducer.ts
 *
 * Pure reducer for annotation state management.
 * Handles add / remove / undo / clear actions.
 *
 * Extracted from ReadingAnnotation.tsx as part of #1855 refactor.
 */

export type AnnotationType = 'unknown' | 'important';

/**
 * Who put this mark here (#3026).
 *
 * `undefined`/absent means 'student' — every annotation persisted before this
 * field existed (DB rows, localStorage snapshots) has no `source` key, and
 * must keep behaving exactly like a student's own mark. Only pre-computed
 * 編者標 (see editorPreMarks.ts) ever carry `'editor'`, and they are computed
 * fresh on every render from `story.vocabulary` — never persisted through
 * this reducer's ADD/REMOVE/UNDO/CLEAR/INIT actions, never saved to
 * localStorage or the DB. That separation is deliberate: it is what keeps
 * 清除全部 / undo / DB-save from touching marks the student never made, and
 * keeps the DB record of "this student's marks" free of editor content.
 *
 * The switch is written to extend to `'teacher'` later (issue #3026's other
 * open scenario) without another reshape of this type.
 */
export type AnnotationSource = 'student' | 'editor';

export interface Annotation {
  id: string;
  paragraphIndex: number;
  charStart: number;
  charEnd: number;
  type: AnnotationType;
  /** Defaults to 'student' wherever absent — see AnnotationSource above. */
  source?: AnnotationSource;
}

export interface AnnotationSummary {
  totalMarks: number;
  unknownCount: number;
  importantCount: number;
}

export interface AnnotationState {
  annotations: Annotation[];
  undoStack: Annotation[][];
}

export type AnnotationAction =
  | {
      type: 'ADD';
      payload: {
        paragraphIndex: number;
        charStart: number;
        charEnd: number;
        annotationType: AnnotationType;
        newAnnotation: Annotation;
      };
    }
  | { type: 'REMOVE'; payload: { id: string } }
  | { type: 'UNDO' }
  | { type: 'CLEAR' }
  | { type: 'INIT'; payload: { annotations: Annotation[] } };

const MAX_UNDO = 19;

export function annotationReducer(
  state: AnnotationState,
  action: AnnotationAction,
): AnnotationState {
  switch (action.type) {
    case 'INIT':
      return { annotations: action.payload.annotations, undoStack: [] };

    case 'ADD': {
      const { paragraphIndex, charStart, charEnd, newAnnotation } = action.payload;
      const snapshot = state.annotations;
      const undoStack = [...state.undoStack.slice(-MAX_UNDO), snapshot];
      // Remove any existing annotations that overlap with the new range
      const filtered = snapshot.filter(
        (a) =>
          a.paragraphIndex !== paragraphIndex ||
          a.charEnd <= charStart ||
          a.charStart >= charEnd,
      );
      return {
        annotations: [...filtered, newAnnotation],
        undoStack,
      };
    }

    case 'REMOVE': {
      const snapshot = state.annotations;
      const undoStack = [...state.undoStack.slice(-MAX_UNDO), snapshot];
      return {
        annotations: snapshot.filter((a) => a.id !== action.payload.id),
        undoStack,
      };
    }

    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        annotations: prev,
        undoStack: state.undoStack.slice(0, -1),
      };
    }

    case 'CLEAR': {
      const snapshot = state.annotations;
      const undoStack = [...state.undoStack.slice(-MAX_UNDO), snapshot];
      return {
        annotations: [],
        undoStack,
      };
    }

    default:
      return state;
  }
}

export function computeSummary(annotations: Annotation[]): AnnotationSummary {
  return {
    totalMarks: annotations.length,
    unknownCount: annotations.filter((a) => a.type === 'unknown').length,
    importantCount: annotations.filter((a) => a.type === 'important').length,
  };
}
