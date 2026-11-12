/**
 * Renders a question stem, bolding + underlining the one character a 注音
 * question asks about (backend `extra.target_index`). The same character can
 * appear more than once in a stem, so without this the projector cannot tell
 * students which one is meant (#3642).
 *
 * `className` lets each screen keep its own existing visual weight — issue
 * #3663 round 2 unified PK's battle screen onto this component (it used to
 * carry its own inline `renderStemWithTarget()` copy of this exact logic,
 * see `StudentPkMatch.tsx`'s git history) by having it pass its own classes
 * here instead of live-quiz/team_arena's default, so no screen's rendered
 * output changes.
 */
import React from 'react';

interface Props {
  stem: string;
  targetIndex?: number | null;
  className?: string;
}

const DEFAULT_CLASS_NAME = 'text-accent underline decoration-4 underline-offset-8';

const StemWithTarget: React.FC<Props> = ({ stem, targetIndex, className = DEFAULT_CLASS_NAME }) => {
  if (targetIndex == null || targetIndex < 0 || targetIndex >= stem.length) return <>{stem}</>;
  return (
    <>
      {stem.slice(0, targetIndex)}
      <span data-testid="stem-target" className={className}>
        {stem[targetIndex]}
      </span>
      {stem.slice(targetIndex + 1)}
    </>
  );
};

export default StemWithTarget;
