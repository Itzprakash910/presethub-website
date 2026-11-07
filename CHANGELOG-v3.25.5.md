# PresetHub v3.25.5: separate full-function pages

Built on v3.25.4. See `docs/PAGES-AND-FEATURES.md` for the full URL map and the list of features that can also become pages.

## What changed
- **Every preset, profile, list and shayari page now shares one shell** (`backend/seo/pageShell.js`): the same header and footer as the home page (read from `index.html`, so they never drift apart), a Back button with breadcrumbs, the dialog container and all scripts.
- **Full function on the pages**: the preset page (`/preset/<id>/<slug>/`) and profile page (`/profile/<id>/<slug>/`) now run the real app inside the page: download or buy, Like (new button, it was missing from the popup too), Save, Share with the QR card, reviews, comments, report, follow, message. The server-rendered text stays as the fallback for Google and for no-JavaScript visitors.
- **New pages**: `/saved/`, `/downloads/`, `/notifications/`, `/messages/`, `/pro/`, `/account/`, `/upload/`, `/my-shares/` (login required, not indexed). The ••• menu opens them as pages. A guest sees "Please log in" and the content appears right after logging in.
- **Home cards open pages**: preset cards, category cards and author names navigate to their own URLs (ctrl/cmd-click opens a new tab); Featured and "सभी Presets" have "view all" links to `/presets/`.
- **Lists and shayari pages** (`/presets/`, categories, tags, `/shayari/`, categories, posts) now have the full header, footer and Back button; meta tags were checked on all 10 page types.
- **Small fixes found while testing**: Back button and "QR only" icons showed black squares (not in the local icon pack: switched to icons that exist, added `fa-qrcode`); the share dialog's "SEO Page" link is hidden when it would point to the same page; guests see "Log in to write a review / comment"; like updates its count in place.
- Service worker cache bumped (`v19`), assets `?v=3.25.5`.

## Tests
`python3 backend/scripts/e2e/pages.py` (77 checks), `python3 backend/scripts/e2e/share-qr.py` (15), plus all earlier suites.

