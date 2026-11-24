# goSTOPS-connect: Product Requirements (PRD)

**Tagline:** A stranger knows the answer. You just have to ask.

**Credit line (must appear on every screen footer):**
Built by Pratik Raj for the goSTOPS Build Sprint. Not an official goSTOPS product.

---

## 1. Summary

goSTOPS-connect is a single web page for goSTOPS common rooms. A guest scans a QR code on the wall, answers one question about themselves, and then gets a random other guest's name and a question about them. The guest walks over, asks, and if the answer is right, earns a small reward. No app, no login, no download.

## 2. Problem

Solo travellers in a common room want to talk to each other but freeze at the first "hi." Nobody wants to start. Most people are on their phones because it gives them something to do, not because they want to be there alone.

## 3. Goal

Give strangers a specific, low-pressure reason to talk. The guest who asks is not making small talk from nothing. They have a question, and the other person has the answer. The guest who answers only has to talk about themselves.

## 4. Target users

- Guests at a goSTOPS hostel common room (college hostel, mess, cafe), on their own phones.
- Introverts who want a reason to talk but not a performance.
- Reception staff who redeem rewards.

## 5. Core flow

1. **Scan and join.** The guest scans the QR code on the wall. The page asks for a first name, then shows 3 word-based questions about themselves. They tap one to choose it. If none suits them, a reload button (two circular arrows) swaps the 3 for others. They type their answer and tap "Go ahead, surprise."
2. **Guess.** The page shows a random other guest's first name and question, such as "What's Prateek's favourite food on this trip?" The guest walks over, asks, types the answer, and taps "Check."
3. **Reward.** A correct answer shows a single-use reward code, such as free coffee or late check-out. The guest shows the code at reception.
4. **Redeem.** Reception enters the code on a staff screen with a PIN. Each code works once and only on the day it was issued.
5. **Empty room.** If no other guest is available, the page says: "No one to guess yet. Try again in a few minutes."

## 6. Screens

- **Join:** name, question, answer, "Go ahead, surprise."
- **Guess:** name and question shown, answer field, "Check." Shows the reward code on success, or remaining tries on a wrong answer.
- **Waiting:** "No one to guess yet. Try again in a few minutes."
- **Locked:** "Three tries used on this one. Try someone else."
- **Reward:** the code, what it is for, and "Show this at reception."
- **Staff:** PIN field, code field, "Redeem," and a result message (valid, already used, expired, or invalid).

## 7. Must-have requirements

- Works in a phone browser, with no download and no login.
- Several guests can use it at the same time.
- Matches strangers at random.
- Checks answers ignoring capitals and extra spaces.
- Locks a profile for a guest after three wrong guesses.
- Never shows a guest someone who joined within 30 seconds of them, so friends who scan together can't match.
- Never shows the same person twice to one guest.
- Issues single-use reward codes that expire at the end of the day (Asia/Kolkata).
- A guest earns at most one reward per day.
- The join screen offers 3 questions at a time, with a reload button to see 3 others.
- Gives reception a working redemption screen.
- Shows the credit line on every screen.

## 8. Out of scope

Chat, profiles, photos, social feed, accounts, notifications, leaderboards, or any feature not listed in section 7.

## 9. Privacy

- Only a first name is shown to other guests. No phone numbers, emails, or surnames are collected.
- Answers are stored as hashes and are never shown to any guest, including after a guess.

## 10. Success measures (for the Loom and write-up)

- Number of guests who joined (profiles created).
- Number of guesses made.
- Number of correct guesses.
- Number of rewards issued and redeemed.
- Rough split of guests by location (college hostel, mess, cafe).

## 11. Known limitations (state these in the submission)

- The 30-second rule only stops friends who scan at nearly the same moment. Friends who scan minutes apart can still match.
- Open answers can be guessed for common cases like "Goa," but rewards are small and the three-try lock slows guessing.
- If the room is small, the same few people get guessed often.

## 12. Open decisions

- Final reward list and how many of each are available per day.
- Question prompt pool: 5 starter prompts agreed. Grow to 10 to 15 before the test.
- Staff PIN holder at reception: to be decided before the test.
