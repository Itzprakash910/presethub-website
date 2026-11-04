# PresetHub Telegram bot: guide

_Generated from the command registry in `backend/bot.js` by `node scripts/bot-selftest.js --docs`. Run it again after changing commands._

## What the bot does
Browse, search and download presets, read and post shayari, manage your account and creator earnings, and (for admins) moderate users, presets and support requests. **Payments never happen in Telegram**: paid presets are bought on the website.

## First message (welcome)
`/start` shows a personal welcome with inline buttons (different for new visitors, linked users, blocked accounts and admins), then attaches the always-visible reply keyboard. New visitors get a one-line privacy notice. `/start preset_<id>` opens a preset card (deep link).

## Reply keyboard (always visible)
🔍 Search · 🆕 Latest · 🔥 Trending · 📂 Categories · ✍️ Shayari · 👑 Pro · 🏠 My Account · 📤 Upload · ❓ Help · 🛠️ Admin Panel (admins only). Tapping one cancels any running step and opens that screen. Plain text with no command is offered as a search.

## Commands
### 🔍 Browse and search
| Command | Aliases | What it does | Usage | Needs |
|---|---|---|---|---|
| `/start` | – | PresetHub खोलें | – | public |
| `/menu` | `/home` | Main menu | – | public |
| `/search` | – | Presets खोजें | `/search <शब्द>` | public |
| `/latest` | `/recent` `/new` | नए presets | – | public |
| `/trending` | `/popular` `/viral` `/presets` | Trending presets | – | public |
| `/toprated` | – | सबसे ज़्यादा rating वाले | – | public |
| `/free` | – | Free presets | – | public |
| `/categories` | – | Categories देखें | – | public |
| `/category` | – | किसी category के presets | `/category <नाम>` | public |
| `/preset` | – | Preset card खोलें | `/preset <id>` | public |
| `/top` | – | Top creators | – | public |
| `/download` | – | Preset download करें | `/download <id>` | login |
| `/share` | – | Preset का share link | `/share <id>` | login |

### 👤 My account
| Command | Aliases | What it does | Usage | Needs |
|---|---|---|---|---|
| `/account` | – | My Account hub | – | login |
| `/dashboard` | – | आपके stats | – | login |
| `/profile` | – | आपकी profile | – | login |
| `/mypresets` | – | आपके presets | – | login |
| `/downloads` | – | आपके downloads | – | login |
| `/wishlist` | `/saved` | Saved presets | – | login |
| `/notifications` | – | Notifications | – | login |
| `/myorders` | `/orders` | आपके orders | – | login |
| `/subscription` | – | Pro plan status | – | login |
| `/referral` | – | Referral code | – | login |
| `/login` | – | Telegram account link करें | – | public |
| `/signup` | – | नया account बनाएँ | – | public |
| `/link` | – | Link code से account जोड़ें | `/link 123456` | public |
| `/logout` | `/unlink` | Telegram unlink करें | – | login |

### 🎨 Creator tools
| Command | Aliases | What it does | Usage | Needs |
|---|---|---|---|---|
| `/upload` | – | Preset upload करें | – | login |
| `/earnings` | – | Creator कमाई और payouts | – | login |
| `/cancel` | – | चल रहा action रोकें | – | public |
| `/skip` | – | Optional step छोड़ें | – | public |

### ✍️ Shayari
| Command | Aliases | What it does | Usage | Needs |
|---|---|---|---|---|
| `/shayari` | – | Shayari पढ़ें | `/shayari [category]` | public |
| `/latestshayari` | – | नई shayari | – | public |
| `/postshayari` | – | Shayari post करें | `/postshayari <category> | <text>` | login |

### 👑 Pro
| Command | Aliases | What it does | Usage | Needs |
|---|---|---|---|---|
| `/pro` | `/plans` | Pro plans | – | public |

### 🆘 Help, privacy and account help
| Command | Aliases | What it does | Usage | Needs |
|---|---|---|---|---|
| `/help` | – | मदद और commands | `/help [command]` | public |
| `/accounthelp` | – | Account की मदद (admin तक) | – | public |
| `/passwordhelp` | – | Password reset मदद | – | public |
| `/accesshelp` | – | Login/access मदद | – | public |
| `/blockhelp` | – | Blocked account review | – | public |
| `/deletehelp` | – | Account delete request | – | public |
| `/privacy` | – | Privacy और आपका data | – | public |
| `/forgetme` | `/deletedata` | Telegram data हटाएँ | – | public |
| `/site` | `/website` | Website खोलें | – | public |

### 🛠️ Admin (admin role + allow-list only)
| Command | Aliases | What it does | Usage | Needs |
|---|---|---|---|---|
| `/admin` | – | Admin panel | – | admin |
| `/adminusers` | – | Users (search) | `/adminusers [नाम/email]` | admin |
| `/adminpresets` | – | Presets moderation | – | admin |
| `/support` | – | Open support requests | – | admin |
| `/alerts` | – | Latest alerts | – | admin |
| `/system` | – | Server और DB status | – | admin |
| `/botstats` | – | Bot usage stats | – | admin |
| `/errors` | – | Recent bot errors | – | admin |
| `/broadcast` | – | Broadcast (website पर) | – | admin |

A mistyped command (for example `/serch`) gets "did you mean" buttons. Commands that need an argument explain the usage and show an example instead of failing.

## Inline buttons
| Where | Buttons |
|---|---|
| Preset card | ⬇️ Download / Get (price) · ❤️ Like · 🔖 Save · 🔗 Share · 🌐 Open on website. Like and Save update in place. |
| Lists (Latest, Trending, search, category) | Number buttons 1-8 open a card · ⬅️ Prev / Next ➡️ · filters All / Free / Paid · sort New / Popular / Rated. Search results have no filter row. |
| My Account hub | Dashboard, Profile, My Presets, Downloads, Saved, Orders, Notifications, Earnings, Subscription, Referral, Upload, Account help, Unlink, Admin. |
| Upload wizard (7 steps) | Category buttons, price buttons (Free / ₹29 / ₹49 / ₹99 or type), Skip for optional steps, Publish / Cancel at the end. |
| Shayari | Category grid, ❤️ Like, 📋 Copy (tap the text to copy), ➡️ More, ✍️ Post (guided). |
| Account help | Password, login/access, blocked, delete account (asks to confirm), other (type a message). |
| Admin | Users (search, details, **Block asks for confirmation**, Unblock), Presets (filter, Approve, **Reject asks for confirmation**), Support (Resolve / In progress / Reject, the user is notified), Alerts, System, Bot stats, Bot errors. |

## Errors: what the user sees and what the admin gets
Every handler runs inside a guard. Errors are classified; the user always gets a clear message with a way forward (never a stack trace, URL or internal text).

| Code | Cause | User sees | Admin alert |
|---|---|---|---|
| USAGE | Wrong command arguments | Usage and example | No |
| AUTH_REQUIRED / AUTH_EXPIRED | Not linked / session no longer valid | Button to link the account | No |
| ACCOUNT_BLOCKED | Blocked or deactivated account | Message and block-review button | No |
| ADMIN_ONLY / ROLE_FORBIDDEN | Not an admin / role lacks the permission | Denied | **Security alert** for attempts by non-admins |
| NOT_FOUND / VALIDATION / CONFLICT | Missing item, bad input, duplicate | Safe text from the API (HTML removed) | No |
| RATE_LIMITED | Too many requests | Wait time | No |
| UPSTREAM_DOWN | Website API unreachable | "Server not responding" | **Critical** |
| UPSTREAM_ERROR / DB_ERROR / INTERNAL | 5xx, database or code error | Generic message + `Ref: ABC123` | **Critical/Warning** with the same Ref, screen, status and short stack |
| FILE_TOO_LARGE | Over Telegram or upload limits | Link to the website | No |
| TELEGRAM_* | "message is not modified", user blocked the bot, old button | Ignored silently | No (formatting errors are reported) |

Alerts are de-duplicated per error type and screen (10 minutes). Admins can list recent errors with `/errors` (Ref, time, code, screen) and see counters with `/botstats`. Polling crashes (for example a 409 during overlapping deploys) restart the bot automatically with a growing delay and raise an alert.

## Security and privacy rules
1. Private chats only. In groups the bot says "use a private chat" once a minute and shows nothing else.
2. Rate limits per Telegram user: 30 events / 30 s, 6 downloads or uploads / minute, 12 likes/saves/posts / minute, 15 searches / minute, 5 link attempts / 10 minutes, plus a global ceiling of 40 link attempts / 10 minutes. Support requests: 3 per hour.
3. Link codes are 6 digits, stored hashed, single use, expire after 10 minutes, and the user's `/link` message is deleted from the chat.
4. Every ID is validated (24 hex characters) before any API call; callback data is parsed strictly; all text is cleaned (control and bidi characters removed, length capped) and HTML-escaped on output.
5. Admin commands and buttons need the admin **role** and, when `ADMIN_TELEGRAM_IDS`/`ADMIN_CHAT_ID` are set, an allow-listed Telegram ID. Every admin button re-checks this. Destructive actions (block user, reject preset) need a second tap. The website API still enforces admin roles and writes the audit log.
6. Uploads: allowed extensions only, 20 MB Telegram limit, one wizard per chat, state expires after 20 minutes.
7. Privacy: people who have not linked an account have **no profile stored**; `/privacy` explains the data; `/forgetme` removes the link and stored Telegram profile; support requests are deleted after one year.
8. Payments, payout details and passwords are never handled in Telegram.

## Environment variables
`BOT_TOKEN` (required), `ADMIN_CHAT_ID` (alerts + admin), `ADMIN_TELEGRAM_IDS` (extra admin IDs, comma separated), `CLIENT_URL`, `API_BASE`, `JWT_SECRET`.

## Tests
`npm run bot:test` drives the real bot with fake Telegram, API and database objects (60 checks: commands, wrong commands, buttons, upload wizard, errors, admin rules, privacy, rate limits, crash restart).
