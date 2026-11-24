const crypto = require('crypto');

/**
 * Normalizes an answer according to TRD Section 5:
 * 1. Convert to lowercase.
 * 2. Trim leading and trailing whitespace.
 * 3. Collapse internal runs of whitespace to a single space.
 * 4. Remove a trailing full stop or exclamation mark.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeAnswer(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/, '');
}

/**
 * Computes HMAC-SHA256 hex string for a normalized answer using ANSWER_SALT.
 *
 * @param {string} normalizedAnswer
 * @param {string} salt
 * @returns {string}
 */
function hashAnswer(normalizedAnswer, salt) {
  if (!salt) {
    throw new Error('ANSWER_SALT is required to hash answer');
  }
  return crypto
    .createHmac('sha256', salt)
    .update(normalizedAnswer)
    .digest('hex');
}

/**
 * Checks if candidate answer matches a stored HMAC hash.
 *
 * @param {string} candidateAnswer
 * @param {string} storedHash
 * @param {string} salt
 * @returns {boolean}
 */
function verifyAnswer(candidateAnswer, storedHash, salt) {
  const normalized = normalizeAnswer(candidateAnswer);
  const computedHash = hashAnswer(normalized, salt);
  
  if (computedHash.length !== storedHash.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(computedHash, 'utf8'),
    Buffer.from(storedHash, 'utf8')
  );
}

module.exports = {
  normalizeAnswer,
  hashAnswer,
  verifyAnswer
};
