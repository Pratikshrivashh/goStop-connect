const assert = require('assert');
const app = require('../server');
const { getDb, resetMockDb } = require('../src/firebase');
const { guestLimiter, staffLimiter } = require('../src/middleware/rateLimiter');

let server;
let baseUrl;

async function request(path, body = {}, method = 'POST') {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: method !== 'GET' ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function runTests() {
  console.log('--- Starting API Routes Integration Tests ---');

  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Clear in-memory DB and rate limiters
    resetMockDb();
    guestLimiter.reset();
    staffLimiter.reset();

    // ==========================================
    // 1. /api/createProfile Tests
    // ==========================================
    console.log('\nTesting /api/createProfile...');

    // Test 1.1: Validation failure - missing fields
    const invalidRes1 = await request('/api/createProfile', {});
    assert.strictEqual(invalidRes1.status, 400);
    assert.strictEqual(invalidRes1.data.error, 'invalid-argument');
    console.log('✓ Rejects missing fields with 400 invalid-argument');

    // Test 1.2: Validation failure - displayName too long (> 20 chars)
    const invalidRes2 = await request('/api/createProfile', {
      guestId: 'guest-1',
      displayName: 'This name is definitely way too long for a hostel',
      questionText: 'What is your favorite food?',
      answer: 'Biryani'
    });
    assert.strictEqual(invalidRes2.status, 400);
    console.log('✓ Rejects displayName > 20 characters');

    // Test 1.3: Successful profile creation
    const guest1 = 'guest-1';
    const createRes1 = await request('/api/createProfile', {
      guestId: guest1,
      displayName: 'Pratik',
      questionText: 'Which travel app do you open most?',
      answer: 'Google Maps'
    });
    assert.strictEqual(createRes1.status, 201);
    assert.ok(createRes1.data.profileId, 'Returns profileId');
    const profileId1 = createRes1.data.profileId;
    console.log('✓ Successfully created profile for guest-1:', profileId1);

    // Test 1.4: Duplicate profile creation for same guestId
    const dupRes = await request('/api/createProfile', {
      guestId: guest1,
      displayName: 'Pratik Raj',
      questionText: 'Which travel app do you open most?',
      answer: 'Airbnb'
    });
    assert.strictEqual(dupRes.status, 409);
    assert.strictEqual(dupRes.data.error, 'already-exists');
    console.log('✓ Rejects duplicate profile with 409 already-exists');

    // ==========================================
    // 2. /api/getNextProfile Tests
    // ==========================================
    console.log('\nTesting /api/getNextProfile...');

    // Test 2.1: Guest who has not joined
    const unjoinedRes = await request('/api/getNextProfile', { guestId: 'unknown-guest' });
    assert.strictEqual(unjoinedRes.status, 412);
    assert.strictEqual(unjoinedRes.data.error, 'failed-precondition');
    console.log('✓ Rejects unjoined guest with 412 failed-precondition');

    // Test 2.2: First guest alone in hostel (no candidates)
    const aloneRes = await request('/api/getNextProfile', { guestId: guest1 });
    assert.strictEqual(aloneRes.status, 200);
    assert.strictEqual(aloneRes.data.empty, true);
    console.log('✓ Returns { empty: true } when no other candidates exist');

    // Test 2.3: Second guest joins within 30 seconds (simulate simultaneous scan)
    const guest2 = 'guest-2';
    const createRes2 = await request('/api/createProfile', {
      guestId: guest2,
      displayName: 'Rohan',
      questionText: "What's the last place you visited that you'd go back to?",
      answer: 'Goa'
    });
    assert.strictEqual(createRes2.status, 201);
    const profileId2 = createRes2.data.profileId;

    // Both joined within seconds, so 30-second rule excludes them from each other
    const simRes1 = await request('/api/getNextProfile', { guestId: guest1 });
    assert.strictEqual(simRes1.data.empty, true, 'guest1 cannot match guest2 (within 30s)');
    const simRes2 = await request('/api/getNextProfile', { guestId: guest2 });
    assert.strictEqual(simRes2.data.empty, true, 'guest2 cannot match guest1 (within 30s)');
    console.log('✓ 30-second rule correctly prevents simultaneous joins from matching');

    // Test 2.4: Third guest who joined 10 minutes ago
    const db = getDb();
    const guest3 = 'guest-3';
    const profileRef3 = db.collection('profiles').doc('profile-3');
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await profileRef3.set({
      displayName: 'Sneha',
      questionText: "What's your favourite snack to carry while travelling?",
      answerHash: require('../src/utils/answer').hashAnswer(
        'makhana',
        process.env.ANSWER_SALT || 'default_dev_salt_1234567890'
      ),
      guestId: guest3,
      submittedAt: tenMinutesAgo
    });
    await db.collection('guests').doc(guest3).set({
      profileId: 'profile-3',
      seenProfileIds: [],
      rewardsToday: 0,
      createdAt: tenMinutesAgo
    });

    const candidateRes = await request('/api/getNextProfile', { guestId: guest1 });
    assert.strictEqual(candidateRes.status, 200);
    assert.strictEqual(candidateRes.data.profileId, 'profile-3');
    assert.strictEqual(candidateRes.data.displayName, 'Sneha');
    assert.strictEqual(candidateRes.data.questionText, "What's your favourite snack to carry while travelling?");
    assert.strictEqual(candidateRes.data.answerHash, undefined, 'Never returns answerHash');
    console.log('✓ Successfully retrieved eligible profile older than 30s (Sneha)');

    // ==========================================
    // 3. /api/submitGuess Tests
    // ==========================================
    console.log('\nTesting /api/submitGuess...');

    // Test 3.1: Ineligible profile guess (trying to guess own profile)
    const ownGuessRes = await request('/api/submitGuess', {
      guestId: guest1,
      profileId: profileId1,
      answer: 'Google Maps'
    });
    assert.strictEqual(ownGuessRes.status, 403);
    assert.strictEqual(ownGuessRes.data.error, 'permission-denied');
    console.log('✓ Denies guessing own profile with 403 permission-denied');

    // Test 3.2: Ineligible profile guess (within 30s)
    const friendGuessRes = await request('/api/submitGuess', {
      guestId: guest1,
      profileId: profileId2,
      answer: 'Goa'
    });
    assert.strictEqual(friendGuessRes.status, 403);
    assert.strictEqual(friendGuessRes.data.error, 'permission-denied');
    console.log('✓ Denies guessing 30-second window profile with 403 permission-denied');

    // Test 3.3: Wrong guess on profile-3 (Sneha)
    const wrong1 = await request('/api/submitGuess', {
      guestId: guest1,
      profileId: 'profile-3',
      answer: 'Chips'
    });
    assert.strictEqual(wrong1.status, 200);
    assert.strictEqual(wrong1.data.correct, false);
    assert.strictEqual(wrong1.data.triesLeft, 2);
    console.log('✓ Wrong guess returns correct: false and triesLeft: 2');

    // Test 3.4: Profile is added to seenProfileIds even after wrong guess
    const seenCheck = await request('/api/getNextProfile', { guestId: guest1 });
    assert.strictEqual(seenCheck.data.empty, true, 'Profile added to seen list so not offered again');
    console.log('✓ Profile added to seenProfileIds so not re-offered');

    // Test 3.5: Lock logic test using another guest
    const guest4 = 'guest-4';
    const profileRef4 = db.collection('profiles').doc('profile-4');
    await profileRef4.set({
      displayName: 'Kabir',
      questionText: 'What kind of music do you play on a long journey?',
      answerHash: require('../src/utils/answer').hashAnswer(
        'indie acoustic',
        process.env.ANSWER_SALT || 'default_dev_salt_1234567890'
      ),
      guestId: guest4,
      submittedAt: new Date(Date.now() - 15 * 60 * 1000)
    });
    await db.collection('guests').doc(guest4).set({
      profileId: 'profile-4',
      seenProfileIds: [],
      rewardsToday: 0,
      createdAt: new Date(Date.now() - 15 * 60 * 1000)
    });

    const lockGuest = 'guest-lock-tester';
    await request('/api/createProfile', {
      guestId: lockGuest,
      displayName: 'Tester',
      questionText: 'Which travel app do you open most?',
      answer: 'Uber'
    });

    // 1st wrong attempt
    const w1 = await request('/api/submitGuess', { guestId: lockGuest, profileId: 'profile-4', answer: 'rock' });
    assert.strictEqual(w1.data.triesLeft, 2);
    // 2nd wrong attempt
    const w2 = await request('/api/submitGuess', { guestId: lockGuest, profileId: 'profile-4', answer: 'pop' });
    assert.strictEqual(w2.data.triesLeft, 1);
    // 3rd wrong attempt -> locks
    const w3 = await request('/api/submitGuess', { guestId: lockGuest, profileId: 'profile-4', answer: 'jazz' });
    assert.strictEqual(w3.data.triesLeft, 0);

    // 4th attempt when locked -> 412 failed-precondition
    const lockedRes = await request('/api/submitGuess', {
      guestId: lockGuest,
      profileId: 'profile-4',
      answer: 'indie acoustic'
    });
    assert.strictEqual(lockedRes.status, 412);
    assert.strictEqual(lockedRes.data.error, 'failed-precondition');
    console.log('✓ Locks profile after 3 wrong guesses and returns 412');

    // Test 3.6: Correct guess with reward code issuance
    const guest5 = 'guest-5';
    const profileRef5 = db.collection('profiles').doc('profile-5');
    await profileRef5.set({
      displayName: 'Tara',
      questionText: "What's the one item you never travel without?",
      answerHash: require('../src/utils/answer').hashAnswer(
        'power bank',
        process.env.ANSWER_SALT || 'default_dev_salt_1234567890'
      ),
      guestId: guest5,
      submittedAt: new Date(Date.now() - 20 * 60 * 1000)
    });
    await db.collection('guests').doc(guest5).set({
      profileId: 'profile-5',
      seenProfileIds: [],
      rewardsToday: 0,
      createdAt: new Date(Date.now() - 20 * 60 * 1000)
    });

    // Guess with uppercase and trailing punctuation: "  POWER BANK!  "
    const correctGuess = await request('/api/submitGuess', {
      guestId: guest1,
      profileId: 'profile-5',
      answer: '  POWER BANK!  '
    });
    assert.strictEqual(correctGuess.status, 200);
    assert.strictEqual(correctGuess.data.correct, true);
    assert.ok(correctGuess.data.code, 'Reward code issued');
    assert.strictEqual(correctGuess.data.code.length, 6);
    assert.ok(correctGuess.data.rewardType, 'Reward type returned');
    const rewardCode = correctGuess.data.code;
    console.log('✓ Correct guess issued reward code:', rewardCode, 'for reward:', correctGuess.data.rewardType);

    // Test 3.7: Daily reward cap (guest1 already earned 1 reward today)
    const guest6 = 'guest-6';
    const profileRef6 = db.collection('profiles').doc('profile-6');
    await profileRef6.set({
      displayName: 'Maya',
      questionText: "What's your favourite city in India so far?",
      answerHash: require('../src/utils/answer').hashAnswer(
        'udaipur',
        process.env.ANSWER_SALT || 'default_dev_salt_1234567890'
      ),
      guestId: guest6,
      submittedAt: new Date(Date.now() - 25 * 60 * 1000)
    });
    await db.collection('guests').doc(guest6).set({
      profileId: 'profile-6',
      seenProfileIds: [],
      rewardsToday: 0,
      createdAt: new Date(Date.now() - 25 * 60 * 1000)
    });

    const secondWin = await request('/api/submitGuess', {
      guestId: guest1,
      profileId: 'profile-6',
      answer: 'udaipur'
    });
    assert.strictEqual(secondWin.status, 200);
    assert.strictEqual(secondWin.data.correct, true);
    assert.strictEqual(secondWin.data.reward, null);
    assert.ok(secondWin.data.message.includes('already'));
    console.log('✓ Daily cap blocks second reward code on the same day');

    // ==========================================
    // 4. /api/redeemReward Tests
    // ==========================================
    console.log('\nTesting /api/redeemReward...');

    // Test 4.1: Wrong PIN
    const wrongPin = await request('/api/redeemReward', {
      code: rewardCode,
      pin: '9999'
    });
    assert.strictEqual(wrongPin.status, 403);
    assert.strictEqual(wrongPin.data.error, 'permission-denied');
    console.log('✓ Rejects wrong PIN with 403 permission-denied');

    // Test 4.2: Non-existent code
    const invalidCode = await request('/api/redeemReward', {
      code: 'ZZZZZZ',
      pin: '1234'
    });
    assert.strictEqual(invalidCode.status, 404);
    assert.strictEqual(invalidCode.data.error, 'invalid');
    console.log('✓ Rejects non-existent code with 404 invalid');

    // Test 4.3: Valid redemption
    const redeemRes = await request('/api/redeemReward', {
      code: rewardCode,
      pin: '1234'
    });
    assert.strictEqual(redeemRes.status, 200);
    assert.strictEqual(redeemRes.data.valid, true);
    assert.ok(redeemRes.data.rewardType);
    console.log('✓ Successfully redeemed reward code:', rewardCode);

    // Test 4.4: Second redemption of same code -> already-used
    const doubleRedeem = await request('/api/redeemReward', {
      code: rewardCode,
      pin: '1234'
    });
    assert.strictEqual(doubleRedeem.status, 409);
    assert.strictEqual(doubleRedeem.data.error, 'already-used');
    console.log('✓ Rejects duplicate redemption with 409 already-used');

    // Test 4.5: Expired code
    const expiredCodeRef = db.collection('rewards').doc('EXPR01');
    await expiredCodeRef.set({
      rewardType: 'Free filter coffee',
      guestId: 'guest-exp',
      profileId: 'profile-exp',
      issuedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      redeemed: false,
      redeemedAt: null
    });
    const expiredRes = await request('/api/redeemReward', {
      code: 'EXPR01',
      pin: '1234'
    });
    assert.strictEqual(expiredRes.status, 410);
    assert.strictEqual(expiredRes.data.error, 'expired');
    console.log('✓ Rejects expired code with 410 expired');

    console.log('\nAll Checkpoint 3 API route tests passed successfully!\n');
  } finally {
    if (server) server.close();
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  if (server) server.close();
  process.exit(1);
});
