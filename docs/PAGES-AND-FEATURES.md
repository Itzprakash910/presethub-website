# Pages and features: PresetHub v3.25.5

Every page below has its own URL, the same header and footer as the home page, a **Back** button with breadcrumbs, and (where it is public) complete meta tags: title, description, canonical, Open Graph, Twitter card, robots and JSON-LD.

## How it works ("page mode")
The server builds each page with one shared shell (`backend/seo/pageShell.js`): the header, footer, dialog container and scripts are read from `frontend/index.html`, so every page matches the home page automatically. The page content is rendered on the server (good for Google and for visitors without JavaScript). When `app.js` runs, it recognises `<body data-page="...">` and draws the **same full-function view that used to open as a popup** inside the page: login, download or buy, like, save, share with QR card, comments, reviews, report, follow, messages. Dialogs (login, share, report, confirmations) still open as popups on top of the page.

## URL map
| Page | URL | Public / indexed | What works on the page |
|---|---|---|---|
| Home | `/` | yes | Featured, Latest and All presets; every card opens its own page |
| Preset | `/preset/<id>/<slug>/` | yes | Download or buy, Like, Save, Share + QR card, reviews, comments, reply, report, edit/delete for the owner, related presets, JSON-LD |
| All presets | `/presets/` | yes | Search, sort, pagination; cards link to preset pages |
| Preset category | `/presets/category/<name>/` | yes | Same as above, per category (home category cards open these) |
| Tags | `/tags/`, `/tags/<tag>/` | yes | Tag cloud and per-tag lists |
| Creator profile | `/profile/<id>/<slug>/` | yes | Follow, message, creator presets, achievements |
| Shayari and text prompts | `/shayari/` | yes | Latest, search, pagination |
| Shayari category | `/shayari/category/<cat>/` (sad, love, alone, ...) | yes | Category collection with copy, like, comment, share |
| Shayari post | `/shayari/<id>/<slug>/` | yes | Full text, copy, like, comment, share, related posts |
| Saved presets | `/saved/` | no (login) | Your saved presets, download, remove |
| Downloads | `/downloads/` | no (login) | Everything you downloaded |
| Notifications | `/notifications/` | no (login) | Read, mark read |
| Messages | `/messages/` | no (login) | Inbox; a chat opens on top |
| PresetHub Pro | `/pro/` | no (login) | Plans and checkout |
| My account | `/account/` | no (login) | Dashboard, your presets, followers |
| Upload | `/upload/` | no (login) | Upload form |
| Share links | `/my-shares/` | no (login) | Your short links, scans and clicks |
| Creator dashboard, Admin | `/creator.html`, `/admin.html` | no | Already separate pages |
| About, FAQ, Contact, Blog, Guides, Terms, Privacy, Cookies, Refund | `*.html` | yes | Already separate pages |

Pages that need a login show "Please log in" with Log in / Sign up buttons; after logging in the content appears on the same page. The Back button goes to the previous page (or to the parent list when the page was opened directly). The ••• menu opens Saved, Downloads, Notifications, Messages, Share links and Pro as pages.

## What stays a popup (and why)
Login and sign-up, Share (with QR card), Report, Boost and Tip, delete and logout confirmations, Account help, change password and edit profile. They are short actions that belong on top of a page, not pages of their own.

## More features that can become pages (same method, small work each)
| Feature | Suggested URL | Notes |
|---|---|---|
| Creators directory | `/creators/` | `GET /api/users/top` already exists |
| Leaderboard and daily streak | `/leaderboard/` | `features.js` already renders it on the home page |
| Search results | `/search/?q=` | Reuse the paged list from `/presets/` |
| Collections | `/collections/<id>/` | `routes/collections.js` exists |
| Nearby creators | `/nearby/` | Needs the location permission (now allowed for the site itself) |
| Referral and rewards | `/referral/` | Data from `/api/users/referrals` |
| Tools | `/tools.html` | Already a page |

To add one: write the view function (or reuse the popup), add a row to `APP_PAGES` in `backend/server.js` (or a route for public pages), and add a case to `mountPageView()` in `frontend/app.js`.

## Tests
`python3 backend/scripts/e2e/pages.py` renders pages from the real route handlers and drives them in headless Chromium: 77 checks covering meta tags on 10 page types, header, footer and Back on every page, the preset page (download, like, save, share + QR, comment, guest login), login-required pages, list to preset navigation, the profile page and shayari actions.
