# PresetHub v3.4.0 — growth features

## 1. Quick wins
- **Daily picks:** `GET /api/features/daily` — one preset and one shayari per India day (same for everyone). Shown in the "Today on PresetHub" section on the home page.
- **Shayari as image:** "image" button on every shayari card creates a 1080×1350 PNG (gradient, auto-fit text, author, watermark) and uses the native share sheet when available.
- **Social proof:** copies, likes and shares are shown on cards and in the leaderboard.
- **Telegram channel:** set `TELEGRAM_CHANNEL_ID`. Viral presets and shayari are posted automatically; the "Today on PresetHub" post goes out once per India day.
- **Login-free browsing:** presets, shayari, tags, leaderboard and daily picks are public. Only downloads, likes, comments, tips and saving require login.

## 2. Engagement
- **Streaks:** `POST /api/features/checkin` (auto on page load when logged in). Consecutive India days extend the streak; a missed day resets it. Every 7-day milestone gives 1 free Pro day. Best streak is kept.
- **Collections:** private or public playlists of presets (`/api/collections`). Save button on every preset card opens a picker; create new collections inline. Max 50 collections, 200 presets each.
- **Follow feed:** "Following" tab shows the latest presets and shayari from creators you follow.
- **Leaderboards:** top creators (by downloads) and top shayari (by copies) for the last 7 days.

## 3. Creators
- **Earnings dashboard:** "My earnings" opens a modal with 30-day sales chart, orders, revenue, tips received, top presets and creator level.
- **Creator levels (computed from downloads):** Bronze (0+), Silver (100+), Gold (1000+) with progress bar.

## 4. Monetization
- **Tips:** ₹10–₹500 to any creator through YOUPI PG (`POST /api/payments/youpi/tip`). The creator's tip total is credited only after payment is verified, and the creator is notified.

## 5. SEO
- Tools page (`/tools.html`) is in the sitemap. Hashtag, preset and shayari pages from v3.3 are unchanged.

## 6. Tools
- **Caption & hashtag generator:** topic × tone → 3 captions and up to 12 hashtags (`/api/features/caption`), one-tap copy.
- **Text on photo:** upload a photo in the browser, add text (position, colour, size), download PNG. The photo is never uploaded to the server.

## 7. Trust & safety
- **Reports:** every shayari, preset, comment and user can be reported with a reason (`POST /api/features/reports`). Duplicate reports by the same user are ignored. Users cannot report their own content.
- **Auto-hide:** a shayari with 5 distinct open reports is hidden until an admin decides. Admin gets an alert.
- **Admin moderation queue:** Reports panel in the admin dashboard — hide content, restore, dismiss or resolve. Resolving one report closes all other open reports on the same item.
- **Verified reviews:** reviews are accepted only from people who bought a paid preset or downloaded a free one. Authors cannot review their own preset.

## Collections, reports, tips — data
- New models: `Collection`, `Report`. User gets `streakCurrent`, `streakBest`, `streakLastDay`, `tipsTotal`. Order gets `kind: tip`, `recipientId`, `note`.

## Tests run
- Streak rules (consecutive days, gaps, same-day, 7-day reward), creator levels, caption sanitising, IST day boundary — all pass.
- Zip guard, login lockout, bot guard — still pass.
- Static checks: every JS file parses; every local asset link and every relative require resolves.

## Not included yet (planned)
- Before/after photo slider (needs a second image per preset upload).
- Preset bundles, pay-what-you-want pricing, sponsored slots.
- Creator verification by documents (blue tick is still follower-based).
- Refund request workflow.
- Live MongoDB and YOUPI end-to-end test (not possible in this sandbox).

## Before deploy
- `cd backend && npm install`
- Optional env: `TELEGRAM_CHANNEL_ID` (e.g. `@presethub` or `-100…`), `AUTO_HIDE_REPORTS` (default 5).
