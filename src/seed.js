const { getDb, getFieldValue } = require('./firebase');
const { hashAnswer } = require('./utils/answer');

const ANSWER_SALT = process.env.ANSWER_SALT || 'default_dev_salt_1234567890';

const DEMO_USERS = [
  {
    guestId: 'demo_guest_atul',
    displayName: 'Atul',
    questionText: 'Where is Atul travelling on his last day?',
    answer: 'Goa'
  },
  {
    guestId: 'demo_guest_sneha',
    displayName: 'Sneha',
    questionText: "What's your favourite snack to carry while travelling?",
    answer: 'Makhana'
  },
  {
    guestId: 'demo_guest_rohan',
    displayName: 'Rohan',
    questionText: 'Which travel app do you open most?',
    answer: 'Google Maps'
  }
];

async function seedDemoUsers() {
  const db = getDb();
  const FieldValue = getFieldValue();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  for (const demo of DEMO_USERS) {
    const guestRef = db.collection('guests').doc(demo.guestId);
    const guestDoc = await guestRef.get();

    if (!guestDoc.exists) {
      const profileRef = db.collection('profiles').doc(`profile_${demo.guestId}`);
      const answerHash = hashAnswer(demo.answer.toLowerCase().trim(), ANSWER_SALT);

      await profileRef.set({
        displayName: demo.displayName,
        questionText: demo.questionText,
        answerHash: answerHash,
        guestId: demo.guestId,
        submittedAt: twoHoursAgo
      });

      await guestRef.set({
        profileId: profileRef.id,
        seenProfileIds: [],
        rewardsToday: 0,
        createdAt: twoHoursAgo
      });

      console.log(`[Seed] Created demo user: ${demo.displayName} (Answer: "${demo.answer}")`);
    }
  }
}

module.exports = {
  seedDemoUsers,
  DEMO_USERS
};
