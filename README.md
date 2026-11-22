# Yatra 🏔️ — The Ultimate Group Travel Companion

Modern, offline-first PWA for group travel: smart itineraries, destination branding, split expenses with debt-minimization, interactive route maps, Gemini-powered receipt scanning, Cloud Storage photo albums with one-tap ZIP downloads, offline emergency SOS & document vault, and Google account sync.

Built with **React 18 + Vite + Tailwind CSS v4 + Firebase 11 (Auth, Firestore, Cloud Storage, Cloud Messaging) + Vitest**.

---

## 🌟 Key Features

### 🖼️ Destination Branding & Themes
- **7 Curated Destination Themes**: Beach & Coastal, Mountains & Snow, Royal Heritage, City & Metro, Forest & Jungle, Desert Safari, Nightlife & Island.
- **Custom Cover Photo Upload**: Upload high-res cover photos with automatic client-side compression and live preview.
- **Auto-Detection**: Suggests destination themes based on trip names (e.g., Goa, Manali, Jaipur, Tokyo).

### 💸 Financial Engine & Split Expenses
- **Debt-Minimization Settle Up**: Calculates the minimal number of peer-to-peer transfers ($O(N)$ transfers) to settle all group debts.
- **Fractional Penny/Paise Precision**: Exact cent/paise allocation with zero floating-point accumulation drift.
- **UPI Deep Links**: 1-tap Google Pay / PhonePe / Paytm payment links directly from debtor to creditor.
- **AI Receipt Scanner**: Powered by Google Gemini Vision to scan restaurant and grocery bills, extract line items, taxes, and service charges, and calculate exact itemized splits.

### 📍 Interactive Route Map
- **Leaflet & OpenStreetMap**: Visualizes trip activities, meeting points, hotel stays, and custom route stops.
- **Geocoding Search**: 1-tap location search with auto-pin drop and coordinates caching.

### 🛡️ Emergency SOS & Offline Vault
- **Offline Document Vault**: Safely cache flight tickets, hotel vouchers, and visa passes in local device storage for zero-connectivity zones.
- **1-Tap Emergency SOS**: Instant dialer for local police, ambulance, and women helpline.
- **Distress Beacon**: Broadcasts exact GPS coordinates to all fellow trip members in real time.

### 📸 Photos & One-Tap ZIP Downloader
- **Firebase Cloud Storage**: High-resolution image uploads with upload progress indicators.
- **Download Full Album as ZIP**: Uses JSZip to download all group trip photos into a single archive file without manual saving.

### 🎒 Smart Packing Assistant
- **Destination Starter Packs**: 1-tap templates tailored for Beach, Trekking/Cold Weather, and City Sightseeing.
- **Shared vs Personal Categorization**: Clothes, Toiletries, Electronics, First-Aid, and Travel Documents.

### 👤 Account Persistence & Cross-Device Sync
- **Frictionless Anonymous Guest Onboarding**: Jump into any trip instantly without passwords.
- **1-Tap Google Sign-In**: Upgrade anonymous accounts to permanent Google accounts via `linkWithPopup`, preserving all trip data and device memberships.

### 📡 Offline Sync & Connectivity Engine
- **Network Status Bar**: Real-time status indicators (🟢 Synced / 🟡 Offline queueing / 🔴 Offline mode).
- Full read/write functionality in airplane mode with automatic Firestore reconciliation upon reconnection.

---

## 🧪 Testing

Yatra includes an automated Vitest suite verifying the mathematical accuracy of financial algorithms, itemized bill calculations, and UPI deep link generators:

```bash
npm test
```

---

## 🚀 CI/CD Pipeline (GitHub Actions)

Located at [`.github/workflows/ci.yml`](.github/workflows/ci.yml):
- **Continuous Integration**: Runs Vitest test suite and builds the production bundle on every push and pull request to `main`/`master`.
- **Firebase Hosting Preview Channels**: Automatically deploys pull requests to ephemeral preview channels (`pr-<number>`) with live URLs commented on the PR.
- **Production Deployment**: Automatically deploys the `main` branch directly to the Firebase Hosting live channel.

### Required GitHub Secrets
To enable automated deployments, configure these repository secrets in **GitHub → Settings → Secrets and variables → Actions**:
- `FIREBASE_SERVICE_ACCOUNT_TRIP_E42A4`: Service account JSON key generated from Google Cloud Console or `firebase init hosting:github`.
- `VITE_GEMINI_API_KEY`: (Optional) Gemini API key for AI receipt scanner.
- `VITE_FB_API_KEY`: (Optional) Firebase Web API key.

---

## 🛠️ Local Development

1. Clone repository and install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   ```bash
   cp .env.example .env
   # Populate with your Firebase & Gemini API credentials
   ```
3. Start development server:
   ```bash
   npm run dev
   ```
4. Build production bundle:
   ```bash
   npm run build
   ```

---

## 📄 License
MIT
