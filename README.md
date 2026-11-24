# goSTOPS-connect

A lightweight icebreaker web application for solo travellers in goSTOPS hostel common rooms.

> **Tagline:** A stranger knows the answer. You just have to ask.  
> **Credit Line:** Built by Pratik Raj for the goSTOPS Build Sprint. Not an official goSTOPS product.

---

## Tech Stack

- **Backend:** Node.js 20 Express server (`server.js`)
- **Database:** Google Cloud Firestore (Spark plan), accessed server-side via `firebase-admin`
- **Frontend:** Pure HTML5, CSS3, and JavaScript (`public/index.html` and `public/staff.html`) with no build step
- **Hosting:** Render Web Service

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set the following variables:
- `FIREBASE_SERVICE_ACCOUNT`: The full JSON string of the Firebase service account key.
- `ANSWER_SALT`: A random secret string used to compute HMAC-SHA256 of normalized answers.
- `STAFF_PIN`: 4 to 6 digit PIN for hostel reception desk (placeholder default `1234`).
- `PORT`: Server port (provided by Render, defaults to `3000` locally).

---

## Local Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the local server:**
   ```bash
   npm start
   ```

3. **Open in browser:**
   - Guest Icebreaker App: [http://localhost:3000](http://localhost:3000)
   - Reception Staff Portal: [http://localhost:3000/staff](http://localhost:3000/staff)

---

## Testing

Run unit tests:
```bash
npm test
```
