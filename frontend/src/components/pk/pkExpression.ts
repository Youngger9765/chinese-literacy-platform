/**
 * resolveAiExpression — the match-state poll's `ai_expression` field (PRD
 * §10.5.3, services/pkApi.ts PkMatchState) travels over the wire as a loose
 * `string | null | undefined`: null for a human match (no figure to react,
 * §8.2), and the backend's `_ai_expression()` (engine.py) is the source of
 * truth for the event->expression mapping itself. This is the one place the
 * frontend narrows + defaults that wire value into a safe PkExpressionKey
 * before handing it to pkFigurePortraitUrl, so the battle screen's large
 * AI-figure portrait panel can never be asked to render a broken image path
 * for an unrecognized or missing value.
 */
import type { PkExpressionKey } from '../../data/pkFigures';

const VALID_EXPRESSIONS: readonly PkExpressionKey[] = [
  'idle',
  'thinking',
  'happy',
  'impressed',
  'frustrated',
  'victory',
  'defeat',
];

export function resolveAiExpression(aiExpression: string | null | undefined): PkExpressionKey {
  if (aiExpression != null && (VALID_EXPRESSIONS as readonly string[]).includes(aiExpression)) {
    return aiExpression as PkExpressionKey;
  }
  return 'idle';
}
