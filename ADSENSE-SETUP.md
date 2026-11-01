# PresetHub Google AdSense setup

PresetHub is a standard HTML/Express website, not an AMP website. Do not add the
`<amp-auto-ads>` element or AMP custom-element loader to its normal HTML pages.

## Current integration

- Publisher client: `ca-pub-3554311294133493`
- Consent-gated AdSense loader: `frontend/cookie-consent.js`
- Homepage display slot: `6615443958` in `frontend/index.html`
- Preset-detail fluid slot: `2217571977` in `frontend/app.js`
- Publisher declaration: `frontend/ads.txt`; the Express server serves frontend
  static files at the site root, so this should be available at `/ads.txt`.
- The Pro membership UI suppresses ad containers/requests where implemented.

## Before production

1. In AdSense, verify the site `presethub.site` and confirm the account is approved.
2. Confirm that the two ad slot IDs above belong to this exact AdSense account and
   are enabled. Replace them if AdSense shows different slot IDs.
3. Confirm `https://presethub.site/ads.txt` returns HTTP 200 and exactly this
   publisher record:

   `google.com, pub-3554311294133493, DIRECT, f08c47fec0942fa0`

4. Test in a clean browser session: reject optional cookies and confirm no AdSense
   network script is loaded; then accept optional cookies and confirm the loader
   is requested. Ads may still not appear until AdSense approval, inventory,
   policy checks and account configuration are complete.
5. Do not manually add a second AdSense loader to `index.html`; the consent manager
   inserts it once after consent. Do not add AMP Auto ads to standard HTML pages.

## Privacy note

The website's cookie consent manager gates the AdSense loader behind the visitor's
optional-cookie choice. AdSense may also use its own consent requirements and
regional consent controls; configure the appropriate Google-certified CMP/consent
mode in the AdSense account for the regions where the site operates. This code
change is not a legal compliance guarantee.
