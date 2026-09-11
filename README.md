# Inbox Appointments

Installable iPhone PWA that scans a connected Gmail inbox for likely upcoming appointments.

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in Google OAuth credentials.
3. In Google Cloud Console, enable Gmail API and add OAuth redirect URI: `http://localhost:3000/api/auth/callback`.
4. `npm run dev`

## Deploy
Deploy to Vercel and set:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- APP_URL=https://your-domain.vercel.app

Then add this redirect URI to your Google OAuth client:
`https://your-domain.vercel.app/api/auth/callback`

## iPhone
Open the deployed URL in Safari → Share → Add to Home Screen.

## Current version
- One Gmail account per browser session
- Read-only Gmail scope
- Searches recent messages for appointment-like confirmations/reminders
- Extracts future date, time, rough location, category, and confidence

## Recommended next upgrade
Use a persistent encrypted database and account table to connect multiple Gmail inboxes at once, plus deduplication and calendar export.
