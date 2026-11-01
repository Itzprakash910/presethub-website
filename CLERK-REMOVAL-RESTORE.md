# Clerk removal / PresetHub legacy authentication restore

- Restored the PresetHub email/password auth routes and JWT middleware from the v3.22 project archive.
- Restored the matching frontend sign-in, sign-up, password reset, and account UI and admin UI.
- Removed the Clerk browser bridge, backend Clerk helper, SDK dependency, injected script, and Clerk CSP origins.
- Added bcryptjs for password hashing.

Existing MongoDB user records and Clerk IDs are not deleted or migrated. Users whose accounts were created only in Clerk may need a password-reset/account-recovery migration before they can use the restored email/password login. Keep a database backup before deployment. Set a strong JWT_SECRET and retain ADMIN_EMAIL/ADMIN role controls.
