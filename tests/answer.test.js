const assert = require('assert');
const { normalizeAnswer, hashAnswer, verifyAnswer } = require('../src/utils/answer');

const TEST_SALT = 'test_secret_salt_1234567890abcdef';

console.log('--- Running Answer Normalisation and HMAC Tests ---');

// Test 1: Lowercase conversion
assert.strictEqual(normalizeAnswer('GOA'), 'goa');
assert.strictEqual(normalizeAnswer('Mumbai'), 'mumbai');
assert.strictEqual(normalizeAnswer('kAcHoRi'), 'kachori');
console.log('✓ Test 1 Passed: Lowercase conversion');

// Test 2: Leading and trailing whitespace trimming
assert.strictEqual(normalizeAnswer('  Filter Coffee  '), 'filter coffee');
assert.strictEqual(normalizeAnswer('\t\nLadakh\n '), 'ladakh');
console.log('✓ Test 2 Passed: Leading and trailing whitespace trimming');

// Test 3: Collapsing internal runs of whitespace
assert.strictEqual(normalizeAnswer('New    Delhi'), 'new delhi');
assert.strictEqual(normalizeAnswer('Old   Manali   Himachal'), 'old manali himachal');
console.log('✓ Test 3 Passed: Internal whitespace collapsing');

// Test 4: Removing trailing full stop or exclamation mark
assert.strictEqual(normalizeAnswer('Goa!'), 'goa');
assert.strictEqual(normalizeAnswer('Rishikesh.'), 'rishikesh');
assert.strictEqual(normalizeAnswer('Manali!!'), 'manali');
assert.strictEqual(normalizeAnswer('Varanasi...'), 'varanasi');
console.log('✓ Test 4 Passed: Trailing punctuation removal');

// Test 5: Preserving internal punctuation
assert.strictEqual(normalizeAnswer("what's up"), "what's up");
assert.strictEqual(normalizeAnswer('st. petersburg'), 'st. petersburg');
console.log('✓ Test 5 Passed: Internal punctuation preserved');

// Test 6: Non-string / empty input handling
assert.strictEqual(normalizeAnswer(''), '');
assert.strictEqual(normalizeAnswer(null), '');
assert.strictEqual(normalizeAnswer(undefined), '');
console.log('✓ Test 6 Passed: Empty and invalid inputs handled safely');

// Test 7: HMAC-SHA256 hashing
const hash1 = hashAnswer('goa', TEST_SALT);
const hash2 = hashAnswer('goa', TEST_SALT);
assert.strictEqual(typeof hash1, 'string');
assert.strictEqual(hash1.length, 64); // SHA256 hex length
assert.strictEqual(hash1, hash2, 'Identical answers and salt must produce identical HMAC');

const hashDifferent = hashAnswer('mumbai', TEST_SALT);
assert.notStrictEqual(hash1, hashDifferent, 'Different answers must produce different HMAC');
console.log('✓ Test 7 Passed: HMAC hashing determinism & collision resistance');

// Test 8: End-to-end verification with variations
const storedHash = hashAnswer(normalizeAnswer('Filter Coffee'), TEST_SALT);
assert.strictEqual(verifyAnswer('filter coffee', storedHash, TEST_SALT), true);
assert.strictEqual(verifyAnswer('   FILTER   COFFEE!  ', storedHash, TEST_SALT), true);
assert.strictEqual(verifyAnswer('Filter Coffee.', storedHash, TEST_SALT), true);
assert.strictEqual(verifyAnswer('Cold Coffee', storedHash, TEST_SALT), false);
console.log('✓ Test 8 Passed: End-to-end answer verification matches all expected variants');

console.log('\nAll Checkpoint 2 tests passed successfully!\n');
