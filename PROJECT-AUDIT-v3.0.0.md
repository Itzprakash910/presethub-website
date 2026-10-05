# PresetHub v3.0.0 — Project Audit & Change Log

## Added

- **Creator discovery carousel** on Home with left/right controls.
- **Nearby creator ranking** using optional browser geolocation. When location is available, creators with saved locations are sorted by distance first, then reach (followers/downloads/views). Without location permission, the fallback ranking is reach-first.
- **Creator location storage** for signed-in users after they explicitly enable nearby suggestions.
- **Admin account controls** for blocking/activating users, permanent deletion, per-user notifications, and **temporary password reset**. Existing passwords are never readable because they are stored as hashes.
- **User account-support requests** for password recovery, account access, deletion requests, and blocked-account review.
- **Telegram account-help workflow** (`/accounthelp`, `/passwordhelp`, `/deletehelp`, `/accesshelp`, `/blockhelp`) with admin notification support.
- **Admin support-request queue** with status management and temporary-password reset actions.
- **Sponsored vs personal ads** with ad type selection, clickable links, title, description, pricing, badge, scheduling, impressions and click tracking.
- **Admin ad image upload** (JPG/PNG/WEBP) to MongoDB GridFS in addition to image URLs.
- **Password show/hide toggle** on login, signup, password reset, change-password and account-deletion confirmation forms.
- **Home-only exit confirmation**. The custom exit dialog no longer appears on every internal page and does not use `beforeunload`, so refresh/close does not trigger the custom message.
- Version bumped to **3.0.0**.

## Security / correctness fixes

- Added server-side validation for ad image uploads and safe GridFS cleanup when ads are replaced/deleted.
- Fixed multipart ad `active=false` handling so the string `"false"` is not treated as truthy.
- Admin temporary passwords invalidate existing sessions through `sessionVersion`.
- Support request status changes notify the affected signed-in user.
- Internal notification links remain restricted to PresetHub paths.

## Audit / verification performed

- Parsed all project JSON manifests checked by the audit.
- Ran `node --check` over backend JavaScript and frontend JavaScript files; no syntax failures were found.
- Checked local HTML links for missing local targets; no missing local targets were found.
- Reviewed authentication, user, admin, ads, notifications, Telegram bot, creator, navigation/exit and upload flows touched by the requested changes.

## Important deployment note

The project requires its normal production environment variables and MongoDB/Telegram/Web Push configuration for live integration testing. This archive was statically audited and syntax-checked; a live MongoDB/payment/Telegram environment was not available in this workspace, so external-service behavior still needs to be smoke-tested after deployment.
