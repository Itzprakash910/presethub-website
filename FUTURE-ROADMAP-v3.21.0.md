# PresetHub Future Roadmap

Firebase is intentionally not part of this release. Continue using the current JWT authentication, MongoDB database and GridFS storage.

## Next production work
1. Payment provider sandbox integration tests: order creation, signature verification, duplicate webhook idempotency, amount/currency mismatch, refunds, and entitlement fulfillment.
2. PhonePe webhook migration only after obtaining the exact merchant-specific HMAC signing specification from PhonePe.
3. Backup restore drill on a disposable MongoDB database; encrypt and store off-site backups; alert on backup failure.
4. Persisted immutable creator ledger with idempotency keys and explicit reversal rows if/when accounting requirements justify it. Current v3.21 ledger is calculated from authoritative Order records and is not a separate accounting journal.
5. Creator dashboard charts with date filters, paginated ledger and downloadable statements.
6. Before/after preview: add optional source image and processed image fields, moderation, responsive slider, and creator upload UI.
7. Bundle marketplace: bundle schema, multi-preset order fulfillment, refunds and creator share allocation.
8. Affiliate/referral sales attribution with anti-self-referral checks, payout threshold and tax disclosures.
9. AI similar-preset search and recommendation: requires a selected AI/image embedding provider, consent/retention policy, moderation, cost limits and API credentials.
10. Creator verification and abuse-resistant review system.
11. PWA offline catalog caching for public metadata only; never cache private user/payment APIs or paid original files.
12. Performance: paginate high-volume admin views, use projections/lean queries, image WebP/AVIF variants, CDN delivery and measured Core Web Vitals.

## Security/privacy constraints
- Never expose payout account details in public APIs.
- Never store card CVV or UPI PIN.
- Do not promise zero risk of data leakage; communicate safeguards and incident response accurately.
- Do not cache authenticated, payment, admin, creator or paid download responses in shared caches.
