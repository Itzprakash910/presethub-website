# PresetHub v3.28.2 — Project Structure

The Render service must build from the repository root (do not set `rootDir: backend`) because `backend/server.js` serves the sibling `frontend/` directory. Root `npm start` runs `node backend/server.js`; root `postinstall` installs backend dependencies.

- `backend/server.js` — Express entry point, API mounting, static frontend serving, health checks and startup tasks.
- `backend/config/` — MongoDB and GridFS configuration.
- `backend/middleware/` — Authentication, authorization, uploads and request controls.
- `backend/models/` — MongoDB/Mongoose schemas.
- `backend/routes/` — API route handlers.
- `backend/utils/` — Shared business logic and integrations.
- `backend/scripts/` — Operational scripts.
- `frontend/` — HTML pages, CSS, browser JavaScript, assets, PWA and SEO files.
- `docs/` — Audit notes and operational documentation.

Authentication uses the PresetHub email/password flow (bcrypt password hashes + JWT). Clerk is not required. For first-time admin setup, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (minimum 12 characters) or run `npm run create-admin` from the repository root as a one-off command. Do not commit real `.env` files or credentials.

Pending presets remain pending until an authorized admin approves them; application startup must not publish pending content automatically.
