# PresetHub v3.25.4

## Performance and accessibility
- Removed the external Google Fonts stylesheet request and switched to system font fallbacks to avoid font network failures and reduce render-blocking requests.
- Added intrinsic hero image dimensions and high-priority async decoding for the featured hero preview.
- Ensured the dynamically selected hero preview is eager/high-priority while below-the-fold featured cards remain lazy-loaded.
- Improved contrast for shayari tags and creator badges, plus visible link and keyboard-focus affordances.

## Security headers
- Added a narrow `script-src-elem` allowlist for the AdSense AMP runtime and existing trusted providers to address the reported CSP block.
- Removed unused Google Fonts CSP origins.
- Enabled production HSTS with one-year max-age, includeSubDomains and preload. Confirm all subdomains are HTTPS-only before deployment.

## Preserved
- MongoDB / GridFS storage, authentication, admin, Telegram bot, preset flows, subscription and payment routes were not intentionally removed or rewritten.

## Known follow-up
- The ~2.29 MiB featured preview in the Lighthouse report is a live MongoDB GridFS media object and is not present in this source ZIP. Re-upload an optimized WebP/AVIF preview (recommended 100–250 KB) or configure an image transformation service. Existing media data was not modified.
- Re-run mobile and desktop PageSpeed after deployment; verify AdSense, Cashfree, login, protected downloads and CSP in browser DevTools.
