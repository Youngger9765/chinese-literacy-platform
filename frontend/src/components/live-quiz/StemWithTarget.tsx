/**
 * Renders a question stem, bolding + underlining the one character a 注音
 * question asks about (backend `extra.target_index`). The same character can
 * appear more than once in a stem, so without this the projector cannot tell
 * students which one is meant (#3642). Same treatment as the PK battle screen.
 */
import React from 'react';

interface Props {
  stem: string;
  targetIndex?: number | null;
}

const StemWithTarget: React.FC<Props> = ({ stem, targetIndex }) => {
  if (targetIndex == null || targetIndex < 0 || targetIndex >= stem.length) return <>{stem}</>;
  return (
    <>
      {stem.slice(0, targetIndex)}
      <span data-testid="stem-target" className="text-accent underline decoration-4 underline-offset-8">
        {stem[targetIndex]}
      </span>
      {stem.slice(targetIndex + 1)}
    </>
  );
};

export default StemWithTarget;
