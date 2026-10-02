# PresetHub v2.2 Fixes

- Persistent IndexedDB upload queue for preset and profile-image uploads; interrupted uploads resume after returning to the site.
- Profile editor now supports avatar upload and keeps text edits pending until the server confirms them.
- Preset edit now supports replacing the preset file and poster/preview image.
- R2 upload failure falls back to local storage so poster/avatar uploads do not fail silently; the real provider error remains in server logs.
- Added featured/trending home section with rating, views, likes, comments, shares and downloads.
- Added global search for presets, creators, categories and tags; removed Google search suggestion.
- Added session cache for public preset/category data to avoid needless reloads while still refreshing in the background.
- Added `/health` alias.
- Fixed Telegram bot database integration to use the current MongoDB models instead of the removed `getDB()` lowdb API.
- Added idempotent `uploadId` for preset uploads to avoid duplicate presets after interrupted navigation/retry.
