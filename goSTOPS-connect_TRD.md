# goSTOPS-connect: Technical Requirements (TRD)

Companion to goSTOPS-connect_PRD.md. Read the PRD first for the product rules.

**Credit line (every screen footer):**
Built by Pratik Raj for the goSTOPS Build Sprint. Not an official goSTOPS product.

---

## 1. Stack

- **Frontend:** single-page app in one `index.html` with inline CSS and JavaScript. No framework, no build step.
- **Hosting:** Firebase Hosting. The QR code points to its URL.
- **Backend:** Firebase Cloud Functions (2nd gen, Node.js 20), region `asia-south1`.
- **Database:** Cloud Firestore, region `asia-south1`.
- **Local state:** browser localStorage for an anonymous `guestId` and the device's join status.
- **Firebase SDK:** client scripts loaded from the Firebase CDN, used only for calling functions and Hosting. The client never reads or writes Firestore directly.

## 2. UI reference

Pratik has attached a UI-ZIP as the visual reference. Match its layout, colours, and typography where practical. Where the ZIP and this document conflict on behaviour, this document wins. Where they conflict on visuals, the ZIP wins. Ask Pratik if the ZIP is not present in the project when you start.

Design constraints regardless of the ZIP:
- Mobile first, designed for a 360 to 412 px wide screen.
- One primary action per screen, large tap targets (at least 44 px).
- Large, readable text. Many users will be reading in a dim common room.
- Works offline-tolerant: show a clear message if a network call fails, with a retry button.

## 3. Configuration

Firebase web config goes in `index.html`:

```js
const firebaseConfig = {
  apiKey: "AIzaSyCQmqO684ari3M_C654EyvU6QDuAQu4914",
  authDomain: "gostops-connect.firebaseapp.com",
  projectId: "gostops-connect",
  storageBucket: "gostops-connect.firebasestorage.app",
  messagingSenderId: "267843496208",
  appId: "1:267843496208:web:16a546c7ab5c9b41c4dd95"
};
```

This config is public by design. Access control comes from Firestore rules and from function-only access, not from hiding the config.

Secrets (never in client code, stored as Firebase function secrets):
- `ANSWER_SALT`: random 32-byte string, used for the answer HMAC.
- `STAFF_PIN`: 4 to 6 digit PIN for reception.

## 4. Data model

**`profiles/{profileId}`** (written only by functions)
- `displayName` (string, 1 to 20 chars)
- `questionText` (string)
- `answerHash` (string, HMAC-SHA256 of the normalized answer with `ANSWER_SALT`)
- `guestId` (string)
- `submittedAt` (server timestamp)

**`guests/{guestId}`**
- `profileId` (string, the guest's own profile)
- `seenProfileIds` (array of strings)
- `rewardsToday` (number)
- `createdAt` (server timestamp)

**`attempts/{guestId}_{profileId}`**
- `wrongCount` (number, 0 to 3)
- `locked` (boolean)

**`rewards/{code}`**
- `rewardType` (string)
- `guestId` (string)
- `profileId` (string)
- `issuedAt` (server timestamp)
- `expiresAt` (timestamp, end of the current day in Asia/Kolkata)
- `redeemed` (boolean)
- `redeemedAt` (server timestamp, nullable)

**`rateLimits/{guestId}`**
- `windowStart` (timestamp)
- `count` (number)

## 5. Answer normalization and hashing

Apply this identically in `createProfile` and `submitGuess`:

1. Convert to lowercase.
2. Trim leading and trailing whitespace.
3. Collapse internal runs of whitespace to a single space.
4. Remove a trailing full stop or exclamation mark.
5. Compute `HMAC-SHA256(ANSWER_SALT, normalized)` and store it as hex.

Do not store the plain answer anywhere.

## 6. Cloud Functions

All functions are callable (`onCall`). Each one first checks the guest's rate limit (max 30 calls per guest per minute). Reject with `resource-exhausted` if exceeded.

### 6.1 `createProfile({ guestId, displayName, questionText, answer })`

- Validate: `displayName` 1 to 20 characters after trimming, `questionText` 5 to 200 characters, `answer` 1 to 60 characters after normalizing.
- If `guests/{guestId}` already has a `profileId`, reject with `already-exists`. One profile per guest.
- Write the profile with `submittedAt = serverTimestamp()`.
- Create `guests/{guestId}` with `profileId`, `seenProfileIds: []`, `rewardsToday: 0`.
- Return `{ profileId }`.

### 6.2 `getNextProfile({ guestId })`

- Require `guests/{guestId}` to exist. If not, reject with `failed-precondition` and tell the client to join first.
- Load the guest's own profile's `submittedAt`.
- Query profiles where `submittedAt >= now - 6 hours`. Limit to 200 documents.
- Exclude:
  - the guest's own profile,
  - any profile whose `submittedAt` is within 30 seconds of the guest's own `submittedAt`, in either direction,
  - any `profileId` in `seenProfileIds`,
  - any profile where `attempts/{guestId}_{profileId}` has `locked = true`.
- If no candidates remain, return `{ empty: true }`.
- Otherwise pick one at random and return `{ profileId, displayName, questionText }`. Never return `answerHash`.

### 6.3 `submitGuess({ guestId, profileId, answer })`

- Re-run the same eligibility checks as `getNextProfile` for this exact `profileId`. Do not trust that the client was shown a valid profile. Reject with `permission-denied` if ineligible.
- Load `attempts/{guestId}_{profileId}`. If locked, reject with `failed-precondition` and the locked message.
- Normalize the answer and compute its HMAC.
- If the hash matches:
  - If `guests/{guestId}.rewardsToday` is already 1 or more, do not issue a reward. Return `{ correct: true, reward: null, message: "You've earned today's reward already." }` and still add the profile to `seenProfileIds`.
  - Generate a code (see 7).
  - Write `rewards/{code}` with `expiresAt` set to the end of the current day in Asia/Kolkata.
  - Increment `rewardsToday`.
  - Return `{ correct: true, code, rewardType }`.
- If the hash does not match:
  - Increment `wrongCount`. Set `locked = true` when it reaches 3.
  - Return `{ correct: false, triesLeft }`.
- Either way, add `profileId` to `guests/{guestId}.seenProfileIds`. A profile is never offered again to that guest, even after a wrong answer, so the guest does not retry it. Locking is the only path for repeat attempts and is enforced by `getNextProfile` anyway.

Use a Firestore transaction for the whole function so counters and seen-lists stay consistent when two guesses land together.

### 6.4 `redeemReward({ code, pin })`

- Check `pin` against `STAFF_PIN`. Wrong PIN returns `permission-denied` and does nothing else.
- Normalize `code` to uppercase and trim.
- In a transaction, load `rewards/{code}`:
  - not found: `invalid`
  - `redeemed = true`: `already-used`
  - `expiresAt` in the past: `expired`
  - otherwise set `redeemed = true`, `redeemedAt = serverTimestamp()`, return `{ valid: true, rewardType }`.
- Rate limit staff calls as well, to slow PIN guessing (max 10 per minute per IP is acceptable; if IP is not available, use a global counter).

## 7. Reward codes

- 6 characters, from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. This excludes 0, O, 1, and I.
- Generate with `crypto.randomInt`, retry if the code already exists in `rewards`.
- The code itself carries no meaning. All validity lives in the document.

## 8. Firestore security rules

Deny all client access. All reads and writes go through Cloud Functions, which use the Admin SDK and bypass rules.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## 9. Frontend behaviour

**On load:**
- Read `guestId` from localStorage. If missing, generate a UUID and store it.
- Read `joined` from localStorage. If true, go to the Guess screen. If false, go to Join.

**Join screen:**
- Show a name field and a question picker with 3 questions from the prompt pool (see section 14).
- Next to the picker is a reload button (two circular arrows icon). Tapping it swaps the 3 shown for 3 others from the pool, without repeating any shown in the last reload. The guest then taps one question to answer.
- Answer field and "Go ahead, surprise" button. Call `createProfile` with the chosen question. On success, set `joined = true` and go to Guess. On `already-exists`, go to Guess.

**Guess screen:**
- Call `getNextProfile`. Show the result:
  - `empty: true` → Waiting screen with a "Check again" button.
  - Otherwise show the name and question. Show the answer field and "Check."
- On "Check," call `submitGuess`:
  - `correct: true` → Reward screen with the code.
  - `correct: false` → show "Not quite. N tries left on this one." then load the next profile.
  - `locked` error → Locked screen, then load the next profile.

**Reward screen:**
- The reward appears in a square card, centred on the screen.
- Animation ("paper blast"): on load, a burst of small paper pieces in the theme colour and white fly outward from the card and fall away, about 1 second. Implement with plain CSS keyframes or a small canvas script, no external library. Respect `prefers-reduced-motion` by skipping the burst.
- Show the code large, what it is for, and "Show this at reception." Include a "Back to guessing" button.

**Staff page:** a separate route, `/staff`, with the PIN and code fields. The PIN is stored only in the page's memory for the session, never in localStorage.

**Errors:** every call shows a clear message and a retry button. Never show raw Firebase error text.

**Footer:** the credit line on every screen.

## 10. Hosting and deployment

- `firebase init hosting` with `public: "public"` and `index.html` as the single page. Put the staff page at `public/staff.html` and add a rewrite from `/staff` to it.
- Deploy functions and rules with `firebase deploy --only functions,firestore:rules,hosting`.
- Set secrets with `firebase functions:secrets:set ANSWER_SALT` and `STAFF_PIN`.
- Cloud Functions require the Blaze (pay-as-you-go) plan. Confirm the project is on Blaze before deploying.
- Warm each function once before the test (a single call) to avoid cold-start delay on the first guess.

## 11. Testing checklist

Run before the hostel test, on real phones over mobile data, not only Wi-Fi.

- Two phones scan at the same moment. Neither is offered the other.
- A profile submitted more than 30 seconds earlier can be offered.
- The first guest sees the "No one to guess yet" message.
- A wrong answer shows tries left. Three wrong answers lock that profile.
- Capitals and extra spaces still match.
- A correct guess issues one code. A second correct guess the same day is blocked by the daily cap.
- A code redeems once. A second redemption returns `already-used`.
- An expired code returns `expired`.
- Wrong staff PIN is rejected.
- `submitGuess` rejects an ineligible profile even when the client sends its ID directly (test with a manual call).
- Firestore direct read from the browser console is denied.

## 12. Risks

- **Cold starts:** the first call can be slow. Warm the functions before the test.
- **Small room:** the same few people get guessed often. State this in the write-up.
- **Reception:** staff need a one-line instruction and the PIN on the night. Test the staff page on a phone before the test.
- **Billing:** Blaze must be enabled. Set a budget alert in Google Cloud at a low amount.

## 13. Build order for the coding agent

1. Project scaffold: Firebase Hosting, Functions, Firestore config, rules.
2. Answer normalization and HMAC helper, with a unit test.
3. `createProfile`, then test by calling it directly.
4. `getNextProfile`, including the 30-second window and seen-list. Test with several fake profiles.
5. `submitGuess` with lock logic and reward creation.
6. `redeemReward` with the transaction and PIN.
7. `index.html`: Join, Guess, Waiting, Locked, Reward screens, matching the UI-ZIP.
8. `staff.html`: redemption screen.
9. Footer credit line on every screen.
10. Deploy, run the testing checklist, and fix anything that fails.

## 14. Question prompt pool (starter)

Store as a constant array in `index.html`. Every prompt must have a short word or phrase answer. Start with these five, and grow the pool to 10 to 15 before the test.

1. Which travel app do you open most?
2. What's the last place you visited that you'd go back to?
3. What's your favourite food you've had on a trip?
4. What's your go-to hobby when you're not travelling?
5. What's one thing you'd recommend at goSTOPS to a first-timer?

The guest's chosen question is stored with the profile. The guesser sees the same question text, with the name filled in.


