/**
 * annotationReducer.ts
 *
 * Pure reducer for annotation state management.
 * Handles add / remove / undo / clear actions.
 *
 * Extracted from ReadingAnnotation.tsx as part of #1855 refactor.
 */

export type AnnotationType = 'unknown' | 'important';

export interface Annotation {
  id: string;
  paragraphIndex: number;
  charStart: number;
  charEnd: number;
  type: AnnotationType;
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
