# Security Policy

## Reporting

Please report security issues privately to the site owner rather than opening a public issue with exploit details.

## Secrets

Never commit:
- JWT secrets
- admin passwords
- Razorpay secret keys
- Telegram bot tokens
- private user database exports
- user-uploaded preset files containing private data

Use environment variables in production.

## Upload security

Preset uploads are limited to supported Lightroom extensions and preview images. Keep the upload directory non-executable and review files before publishing.

## Admin

Admin access is controlled by the `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables. Change the admin password before production use.

## Deployment

Use HTTPS, keep dependencies updated, and configure persistent storage for uploads/database data on your hosting provider.
