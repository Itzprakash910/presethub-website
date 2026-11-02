# PresetHub v3.25.0 — UI fixes from device screenshots

## Footer (every page)
- The same footer as the homepage on every public page, including privacy, refund, terms, shayari, preset and list pages.
- Icons (social, Install App, Telegram, camera) now load on static pages: `icons.css` is linked on every page. These pages were missing it.
- Footer Legal list has a **Cookie settings** link that reopens the consent banner.

## Streak and My dashboard moved to the profile menu
- Removed from the homepage "Today on PresetHub" strip.
- Profile menu: "N-day streak · Check in" (runs the daily check-in) and "My dashboard" (opens the creator dashboard). Both require sign-in.

## Ads between presets
- New `GET /api/ads/feed` returns up to 12 active ads (impressions counted once per load).
- A sponsored card appears after every 6 presets. It uses the same card size, layout and buttons as a preset, with a "Sponsored" tag.
- Clicks open the advertiser link in a new tab (http and https only) and are counted (`POST /api/ads/:id/click`).
- The old single banner above the feed is gone.

## Header: Pro (subscription) button
- A round crown button with the same size as the other header buttons. The label stays available to screen readers.

## Cookie settings and banner
- The floating "Cookie settings" pill that covered content is removed. The footer link does the same job.
- On phones the banner buttons sit in a two-column grid, so labels are no longer cut off.

## Preset cards
- The action row wraps: icon buttons on one row, "Open" full width below. Nothing is pushed out of the card.

## Checks run
- Syntax of all JS files; undefined names in the changed files; HTML local links; one footer per public page.

## Not verified here
- The layouts above are checked by code and markup only. Look at the homepage, a preset card, a shayari page, the privacy page and the header on a phone after deploy.
- Feed checks (presets, categories, shayari, ads, tags, daily picks) need a live run against the database.
