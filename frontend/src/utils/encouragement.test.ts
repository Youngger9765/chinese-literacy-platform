/**
 * Simple unit tests for encouragement utility (Issue #268)
 * Run with: npx tsx src/utils/encouragement.test.ts
 */
import { ENCOURAGEMENT_MESSAGES, getEncouragementMessage } from './encouragement';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

// Test 1: ENCOURAGEMENT_MESSAGES is a non-empty array
assert(Array.isArray(ENCOURAGEMENT_MESSAGES) && ENCOURAGEMENT_MESSAGES.length > 0,
  'ENCOURAGEMENT_MESSAGES is a non-empty array');

// Test 2: All messages are non-empty strings
assert(ENCOURAGEMENT_MESSAGES.every(m => typeof m === 'string' && m.length > 0),
  'All messages are non-empty strings');

// Test 3: getEncouragementMessage returns a string from the list
const msg = getEncouragementMessage();
assert(typeof msg === 'string' && msg.length > 0,
  'getEncouragementMessage() returns a non-empty string');

assert((ENCOURAGEMENT_MESSAGES as readonly string[]).includes(msg),
  'getEncouragementMessage() returns a value from ENCOURAGEMENT_MESSAGES');

// Test 4: Multiple calls return values from the list (randomness check)
const results = new Set(Array.from({ length: 30 }, () => getEncouragementMessage()));
// With 6 messages and 30 calls, we should see at least 2 different ones with high probability
assert(results.size >= 2,
  'getEncouragementMessage() returns different values across multiple calls');

// Test 5: All returned values are valid list members
const allValid = Array.from({ length: 20 }, () => getEncouragementMessage())
  .every(m => (ENCOURAGEMENT_MESSAGES as readonly string[]).includes(m));
assert(allValid, 'All returned messages are from the defined list');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
