# PresetHub v3.19.0 — PhonePe PG v2

- Added PhonePe Standard Checkout v2 (OAuth client credentials).
- Added authenticated PhonePe webhook endpoint and server-to-server order-status verification.
- Added PhonePe order refresh for delayed webhook recovery.
- Preserved Cashfree and YouPI integrations and their existing order fulfillment.
- Added preferred-provider selection with configured-provider fallback.
- Expanded MongoDB Order provider enum to include `phonepe`.
- Updated checkout frontend to route to the selected gateway.

See `PHONEPE-SETUP.md` for environment variables, webhook setup and sandbox testing.
