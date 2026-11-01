# PresetHub v3.27.0

- Documented the existing Google AdSense integration and production verification steps.
- Kept the existing publisher ID and ads.txt publisher declaration.
- Removed the AMP Auto Ads approach from the integration instructions: the site is standard HTML, not an AMP implementation.
- Updated preset-detail modal ads so the ad container and ad request are created only after optional advertising consent has been accepted and the user is not marked as a Pro member.
- Preserved the homepage AdSense slot and the existing consent-gated loader.

AdSense approval, ad-slot ownership, live ad serving, and regional CMP configuration still require verification in the publisher's Google AdSense account.
