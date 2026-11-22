# Yatra 🏔️ — one app for the group trip

PWA with join-by-link, day-wise itinerary, headcount, shared and personal packing lists, and expenses with UPI settle-up.
Built on React + Vite + Tailwind + Firebase (Anonymous Auth, Firestore with offline cache, Hosting).

## Setup (one time)
1. In the [Firebase console](https://console.firebase.google.com), create a project and add a **Web app**.
2. Enable **Authentication → Sign-in method → Anonymous**.
3. Create a **Firestore** database (production mode, `asia-south1`).
4. `cp .env.example .env` and paste the web config values.
5. `npm install && npm run dev`

## Deploy
```bash
npm i -g firebase-tools
firebase login
firebase use --add        # pick your project
npm run deploy            # builds, deploys hosting + Firestore rules
```
Share `https://<project>.web.app` and create a trip; the Group tab has the invite link.

## Data model
```
trips/{tripId}              name, start, end, createdBy
  members/{uid}             name, upi
  plan/{id}                 date, time, title, place, notes
  packing/{id}              text, owner (null = group), bringer, done
  expenses/{id}             title, amount, paidBy, splits {uid: share}
  headcounts/{id}           label, present {uid: true}, closed
```

## Next up
Polls · live map · photo drop · push reminders (FCM) · receipt scan · Trip Wrapped
