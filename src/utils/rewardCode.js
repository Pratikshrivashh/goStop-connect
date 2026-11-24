const crypto = require('crypto');
const { REWARD_CODE_ALPHABET, REWARD_POOL } = require('../constants');

/**
 * Generates a random 6-character reward code from the allowed alphabet:
 * ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (excludes 0, O, 1, I).
 *
 * @returns {string}
 */
function generateRewardCode() {
  let code = '';
  const alphabetLength = REWARD_CODE_ALPHABET.length;
  for (let i = 0; i < 6; i++) {
    const randomIndex = crypto.randomInt(0, alphabetLength);
    code += REWARD_CODE_ALPHABET[randomIndex];
  }
  return code;
}

/**
 * Calculates the end of the current day (23:59:59.999) in Asia/Kolkata timezone.
 *
 * @param {Date} [date=new Date()]
 * @returns {Date}
 */
function getEndOfDayKolkata(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const datePart = formatter.format(date); // YYYY-MM-DD
  return new Date(`${datePart}T23:59:59.999+05:30`);
}

/**
 * Randomly picks one reward from the 5-item reward pool.
 *
 * @returns {string}
 */
function getRandomReward() {
  const index = crypto.randomInt(0, REWARD_POOL.length);
  return REWARD_POOL[index];
}

module.exports = {
  generateRewardCode,
  getEndOfDayKolkata,
  getRandomReward
};
