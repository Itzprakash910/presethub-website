# PageSpeed optimization notes — v3.25.4

Applied in this archive:
- Removed the render-blocking Google Fonts stylesheet request; the UI now uses local system font fallbacks.
- Added explicit, narrow `script-src-elem` entries for the AdSense AMP runtime and existing trusted script providers.
- Removed unused Google Fonts CSP origins after removing the external font request.
- Enabled production HSTS with a one-year max-age, includeSubDomains and preload. Deploy only when every subdomain is HTTPS-only.
- Improved tag/creator badge contrast and visible link/focus affordances.
- Set intrinsic dimensions and eager/high-priority behavior for the hero image.

Still requires production data / browser verification:
- The largest image reported by Lighthouse is served from MongoDB GridFS (`/media/:id`), not contained in this ZIP. It must be re-uploaded as an optimized WebP/AVIF preview (target 100–250 KB, suitable dimensions) or processed by an image-transform service. This archive does not alter existing GridFS objects or add a native image-processing dependency, to avoid risking stored media and production deployment compatibility.
- Re-run PageSpeed on mobile and desktop after deployment. Verify AdSense, Cashfree checkout, analytics, login, public and protected media, and the CSP in browser DevTools.
- `401` from `/api/auth/me` for logged-out visitors can be expected; public media must not require auth. Confirm any reported `/media/:id` 401 corresponds to a protected preset binary rather than a public preview.
- Trusted Types enforcement is intentionally not enabled until DOM sinks are audited; enabling it prematurely can break app functionality.


> See ../CHANGELOG-v3.25.5.md for the follow-up fixes (401 console errors, render-blocking CSS, hero image, /media hardening, minify + compression).
