const express = require('express');
const router = express.Router();
const { getDb, getFieldValue, getTimestamp } = require('../firebase');
const { normalizeAnswer, hashAnswer, verifyAnswer } = require('../utils/answer');
const { generateRewardCode, getEndOfDayKolkata, getRandomReward } = require('../utils/rewardCode');
const { guestRateLimitMiddleware, staffRateLimitMiddleware } = require('../middleware/rateLimiter');

const ANSWER_SALT = process.env.ANSWER_SALT || 'default_dev_salt_1234567890';
const STAFF_PIN = process.env.STAFF_PIN || '1234';

/**
 * POST /api/createProfile
 * Creates a guest profile with an HMAC of their answer.
 * Body: { guestId, displayName, questionText, answer }
 */
router.post('/createProfile', guestRateLimitMiddleware, async (req, res) => {
  try {
    const { guestId, displayName, questionText, answer } = req.body || {};

    if (!guestId || typeof guestId !== 'string') {
      return res.status(400).json({ error: 'invalid-argument', message: 'guestId is required.' });
    }

    const trimmedName = typeof displayName === 'string' ? displayName.trim() : '';
    if (trimmedName.length < 1 || trimmedName.length > 20) {
      return res.status(400).json({
        error: 'invalid-argument',
        message: 'displayName must be between 1 and 20 characters.'
      });
    }

    const trimmedQuestion = typeof questionText === 'string' ? questionText.trim() : '';
    if (trimmedQuestion.length < 5 || trimmedQuestion.length > 200) {
      return res.status(400).json({
        error: 'invalid-argument',
        message: 'questionText must be between 5 and 200 characters.'
      });
    }

    const normalizedAnswer = normalizeAnswer(answer);
    if (normalizedAnswer.length < 1 || normalizedAnswer.length > 60) {
      return res.status(400).json({
        error: 'invalid-argument',
        message: 'answer must be between 1 and 60 characters.'
      });
    }

    const db = getDb();
    const FieldValue = getFieldValue();

    // Check if guest already has a profile
    const guestRef = db.collection('guests').doc(guestId);
    const guestDoc = await guestRef.get();
    if (guestDoc.exists && guestDoc.data()?.profileId) {
      return res.status(409).json({
        error: 'already-exists',
        message: 'A profile has already been created for this guest.'
      });
    }

    const answerHash = hashAnswer(normalizedAnswer, ANSWER_SALT);
    const profileRef = db.collection('profiles').doc();

    await profileRef.set({
      displayName: trimmedName,
      questionText: trimmedQuestion,
      answerHash,
      guestId,
      submittedAt: FieldValue.serverTimestamp()
    });

    await guestRef.set(
      {
        profileId: profileRef.id,
        seenProfileIds: [],
        rewardsToday: 0,
        createdAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return res.status(201).json({ profileId: profileRef.id });
  } catch (err) {
    console.error('Error in createProfile:', err);
    return res.status(500).json({
      error: 'internal',
      message: 'Failed to create profile. Please try again.'
    });
  }
});

/**
 * POST /api/getNextProfile
 * Gets a candidate profile for guessing.
 * Body: { guestId }
 */
router.post('/getNextProfile', guestRateLimitMiddleware, async (req, res) => {
  try {
    const { guestId } = req.body || {};

    if (!guestId || typeof guestId !== 'string') {
      return res.status(400).json({ error: 'invalid-argument', message: 'guestId is required.' });
    }

    const db = getDb();
    const guestRef = db.collection('guests').doc(guestId);
    const guestDoc = await guestRef.get();

    if (!guestDoc.exists || !guestDoc.data()?.profileId) {
      return res.status(412).json({
        error: 'failed-precondition',
        message: 'Guest profile not found. Please join first.'
      });
    }

    const guestData = guestDoc.data();
    const ownProfileRef = db.collection('profiles').doc(guestData.profileId);
    const ownProfileDoc = await ownProfileRef.get();

    if (!ownProfileDoc.exists) {
      return res.status(412).json({
        error: 'failed-precondition',
        message: 'Own profile record not found. Please join first.'
      });
    }

    const ownData = ownProfileDoc.data();
    const ownSubmittedAt = ownData.submittedAt?.toDate
      ? ownData.submittedAt.toDate().getTime()
      : new Date(ownData.submittedAt || Date.now()).getTime();

    // Query profiles submitted in the last 6 hours (limit 200)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const profilesSnapshot = await db
      .collection('profiles')
      .where('submittedAt', '>=', sixHoursAgo)
      .limit(200)
      .get();

    const seenSet = new Set(guestData.seenProfileIds || []);
    const eligibleProfiles = [];

    for (const doc of profilesSnapshot.docs) {
      const candidateId = doc.id;
      const candidate = doc.data();

      // Rule 1: Not own profile
      if (candidateId === guestData.profileId || candidate.guestId === guestId) {
        continue;
      }

      // Rule 2: Exclude profiles submitted within 30 seconds of guest's submission
      const candidateTime = candidate.submittedAt?.toDate
        ? candidate.submittedAt.toDate().getTime()
        : new Date(candidate.submittedAt || Date.now()).getTime();

      if (Math.abs(candidateTime - ownSubmittedAt) <= 30 * 1000) {
        continue;
      }

      // Rule 3: Exclude already seen profiles
      if (seenSet.has(candidateId)) {
        continue;
      }

      // Rule 4: Exclude locked profiles
      const attemptDoc = await db.collection('attempts').doc(`${guestId}_${candidateId}`).get();
      if (attemptDoc.exists && attemptDoc.data()?.locked) {
        continue;
      }

      eligibleProfiles.push({
        profileId: candidateId,
        displayName: candidate.displayName,
        questionText: candidate.questionText
      });
    }

    if (eligibleProfiles.length === 0) {
      return res.json({ empty: true });
    }

    // Pick one at random
    const randomIndex = Math.floor(Math.random() * eligibleProfiles.length);
    const chosen = eligibleProfiles[randomIndex];

    return res.json({
      profileId: chosen.profileId,
      displayName: chosen.displayName,
      questionText: chosen.questionText
    });
  } catch (err) {
    console.error('Error in getNextProfile:', err);
    return res.status(500).json({
      error: 'internal',
      message: 'Failed to retrieve next profile. Please try again.'
    });
  }
});

/**
 * POST /api/submitGuess
 * Validates a guest's guess for another guest's profile.
 * Body: { guestId, profileId, answer }
 */
router.post('/submitGuess', guestRateLimitMiddleware, async (req, res) => {
  try {
    const { guestId, profileId, answer } = req.body || {};

    if (!guestId || typeof guestId !== 'string') {
      return res.status(400).json({ error: 'invalid-argument', message: 'guestId is required.' });
    }
    if (!profileId || typeof profileId !== 'string') {
      return res.status(400).json({ error: 'invalid-argument', message: 'profileId is required.' });
    }
    if (typeof answer !== 'string') {
      return res.status(400).json({ error: 'invalid-argument', message: 'answer is required.' });
    }

    const db = getDb();
    const FieldValue = getFieldValue();

    const result = await db.runTransaction(async (transaction) => {
      const guestRef = db.collection('guests').doc(guestId);
      const guestDoc = await transaction.get(guestRef);
      if (!guestDoc.exists || !guestDoc.data()?.profileId) {
        return { status: 412, data: { error: 'failed-precondition', message: 'Guest profile not found.' } };
      }

      const guestData = guestDoc.data();
      const ownProfileRef = db.collection('profiles').doc(guestData.profileId);
      const ownProfileDoc = await transaction.get(ownProfileRef);
      if (!ownProfileDoc.exists) {
        return { status: 412, data: { error: 'failed-precondition', message: 'Own profile not found.' } };
      }

      const candidateProfileRef = db.collection('profiles').doc(profileId);
      const candidateProfileDoc = await transaction.get(candidateProfileRef);
      if (!candidateProfileDoc.exists) {
        return { status: 403, data: { error: 'permission-denied', message: 'Ineligible profile.' } };
      }

      const candidateData = candidateProfileDoc.data();

      // Eligibility Check 1: Cannot guess own profile
      if (profileId === guestData.profileId || candidateData.guestId === guestId) {
        return { status: 403, data: { error: 'permission-denied', message: 'Cannot guess your own profile.' } };
      }

      // Eligibility Check 2: 30-second window
      const ownTime = ownProfileDoc.data().submittedAt?.toDate
        ? ownProfileDoc.data().submittedAt.toDate().getTime()
        : new Date(ownProfileDoc.data().submittedAt || Date.now()).getTime();

      const candidateTime = candidateData.submittedAt?.toDate
        ? candidateData.submittedAt.toDate().getTime()
        : new Date(candidateData.submittedAt || Date.now()).getTime();

      if (Math.abs(candidateTime - ownTime) <= 30 * 1000) {
        return { status: 403, data: { error: 'permission-denied', message: 'Profile is within 30-second window.' } };
      }

      // Eligibility Check 3: Check if already locked
      const attemptRef = db.collection('attempts').doc(`${guestId}_${profileId}`);
      const attemptDoc = await transaction.get(attemptRef);
      if (attemptDoc.exists && attemptDoc.data()?.locked) {
        return {
          status: 412,
          data: {
            error: 'failed-precondition',
            message: 'Three tries used on this one. Try someone else.'
          }
        };
      }

      const isMatch = verifyAnswer(answer, candidateData.answerHash, ANSWER_SALT);

      if (isMatch) {
        // Correct answer
        const currentRewardsToday = guestData.rewardsToday || 0;

        if (currentRewardsToday >= 1) {
          // Already earned today's reward
          transaction.update(guestRef, {
            seenProfileIds: FieldValue.arrayUnion(profileId)
          });
          return {
            status: 200,
            data: {
              correct: true,
              reward: null,
              capped: true,
              message: "You've earned today's reward already. Limit: 1 reward per guest per day."
            }
          };
        }

        // Generate a unique 6-character reward code
        let code = generateRewardCode();
        let codeRef = db.collection('rewards').doc(code);
        let existingCodeDoc = await transaction.get(codeRef);
        let retries = 0;
        while (existingCodeDoc.exists && retries < 5) {
          code = generateRewardCode();
          codeRef = db.collection('rewards').doc(code);
          existingCodeDoc = await transaction.get(codeRef);
          retries++;
        }

        const rewardType = getRandomReward();
        const expiresAt = getEndOfDayKolkata();

        transaction.set(codeRef, {
          rewardType,
          guestId,
          profileId,
          issuedAt: FieldValue.serverTimestamp(),
          expiresAt,
          redeemed: false,
          redeemedAt: null
        });

        transaction.update(guestRef, {
          rewardsToday: FieldValue.increment(1),
          seenProfileIds: FieldValue.arrayUnion(profileId)
        });

        return {
          status: 200,
          data: {
            correct: true,
            code,
            rewardType
          }
        };
      } else {
        // Wrong answer
        const currentWrong = (attemptDoc.exists ? attemptDoc.data()?.wrongCount || 0 : 0) + 1;
        const locked = currentWrong >= 3;

        transaction.set(
          attemptRef,
          {
            wrongCount: currentWrong,
            locked
          },
          { merge: true }
        );

        transaction.update(guestRef, {
          seenProfileIds: FieldValue.arrayUnion(profileId)
        });

        const triesLeft = Math.max(0, 3 - currentWrong);

        return {
          status: 200,
          data: {
            correct: false,
            triesLeft
          }
        };
      }
    });

    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('Error in submitGuess:', err);
    return res.status(500).json({
      error: 'internal',
      message: 'Failed to process guess. Please try again.'
    });
  }
});

/**
 * POST /api/redeemReward
 * Staff endpoint to validate and redeem a reward code with PIN.
 * Body: { code, pin }
 */
router.post('/redeemReward', staffRateLimitMiddleware, async (req, res) => {
  try {
    const { code, pin } = req.body || {};

    if (!pin || String(pin).trim() !== String(STAFF_PIN).trim()) {
      return res.status(403).json({
        valid: false,
        error: 'permission-denied',
        message: 'Invalid staff PIN.'
      });
    }

    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        valid: false,
        error: 'invalid',
        message: 'Reward code is required.'
      });
    }

    const normalizedCode = code.trim().toUpperCase();
    const db = getDb();
    const FieldValue = getFieldValue();

    const result = await db.runTransaction(async (transaction) => {
      const rewardRef = db.collection('rewards').doc(normalizedCode);
      const rewardDoc = await transaction.get(rewardRef);

      if (!rewardDoc.exists) {
        return {
          status: 404,
          data: {
            valid: false,
            error: 'invalid',
            message: 'Reward code does not exist.'
          }
        };
      }

      const rewardData = rewardDoc.data();

      if (rewardData.redeemed) {
        return {
          status: 409,
          data: {
            valid: false,
            error: 'already-used',
            message: 'This reward code has already been redeemed.'
          }
        };
      }

      const expiresAt = rewardData.expiresAt?.toDate
        ? rewardData.expiresAt.toDate()
        : new Date(rewardData.expiresAt);

      if (expiresAt < new Date()) {
        return {
          status: 410,
          data: {
            valid: false,
            error: 'expired',
            message: 'This reward code has expired.'
          }
        };
      }

      transaction.update(rewardRef, {
        redeemed: true,
        redeemedAt: FieldValue.serverTimestamp()
      });

      return {
        status: 200,
        data: {
          valid: true,
          rewardType: rewardData.rewardType
        }
      };
    });

    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('Error in redeemReward:', err);
    return res.status(500).json({
      error: 'internal',
      message: 'Failed to redeem reward. Please try again.'
    });
  }
});

module.exports = router;
