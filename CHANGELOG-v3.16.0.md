# PresetHub v3.16.0 — Google Search Console meta verification

## What changed
- `frontend/index.html`: placeholder `<!--GSC_VERIFY-->` in `<head>`.
- `backend/server.js`: `/` and `/index.html` are served by a route (before the static files) that replaces the placeholder with
  `<meta name="google-site-verification" content="...">` when `GSC_VERIFICATION_TOKEN` is set. Without the variable, no tag is added.
- The token is sanitised: only letters, digits, `_` and `-` are kept, so it cannot inject HTML.
- The homepage is cached for 5 minutes (`Cache-Control: public, max-age=300`).

## Setup
1. Search Console → Settings → Ownership verification → **HTML tag** → copy only the `content="..."` value (not the whole tag).
2. Render → Environment → add `GSC_VERIFICATION_TOKEN` with that value → redeploy.
3. Open `https://presethub.site/`, view the page source, and confirm the meta tag is in `<head>`.
4. Click **Verify** in Search Console.

If you already put the tag in `index.html` by hand, remove that copy, so there is only one verification tag.

## Not included
- The verification token itself. It is unique to your Search Console property and must come from Search Console.
- Other Search Console checks (live test after the 403 fix, sitemap submission, and requesting indexing) still need to be done in Search Console after deploy.
