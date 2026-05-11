# Miwa API — Project Notes for AI Agents

This file is the single source of truth for project conventions, read by
both Claude Code (via a one-line `@AGENTS.md` import in `CLAUDE.md`) and
Codex Cloud (which reads `AGENTS.md` natively). Update this file when
conventions change; the other file does not need to be touched.

## User identity

When generating content that signs as the user or refers to them by
title (welcome messages, marketing copy, signatures, founder bios,
about pages, anywhere a name + role appears), use:

> **Valdrex Philippe, MFT Trainee**
> Founder, Miwa

Never just "Valdrex" alone in product copy — always include the full
name + role. Casual chat references in the conversation are fine to
use the first name.

## Workflow preferences

### Auto-push code changes
When you finish a code change in this repo, **commit and push to `main`
without being asked**. The user does not want to manually request a push
each time. The flow is:

1. Run `git status` to confirm what changed
2. Stage the relevant files (named, not `git add .`)
3. Commit with a short, intent-focused message + a
   `Co-Authored-By:` trailer that names the agent + model doing the
   work. Examples:
   - `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
   - `Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>`
4. Push: `git push origin HEAD:main` (the working branch usually tracks
   origin/main but the local branch name differs from `main`, so
   `HEAD:main` is required)
5. Run `gh run list --limit 1` to surface the queued deploy

Skip the push only if the user explicitly says "don't push yet" or the
change is clearly experimental / scratch work. When in doubt, push.

### Don't push
- If pre-commit hooks fail — fix the underlying issue and create a NEW
  commit, never `--amend` (the original commit didn't land, so amending
  rewrites the wrong thing).
- If the change is mid-investigation and not yet a coherent unit.

## Deployment

- **Pipeline:** GitHub Actions → Azure App Service (`miwa-api-prod`)
- **Trigger:** any push to `main`
- **Workflow file:** `.github/workflows/main_miwa-api-prod.yml`
- **Concurrency:** new pushes cancel in-flight runs (so back-to-back
  pushes are fine — only the latest builds)
- **Average build time:** ~4-5 minutes from push to live
- **Verification commands:**
  - `gh run list --limit 1` — last run status
  - `gh run watch` — tail in real time
  - `gh run view --log-failed` — failure logs
  - `gh run view --web` — open in browser

## Product direction

- **Solo therapist focus.** Group practice is intentionally NOT offered
  as a purchasable plan — it's a "Coming soon" waitlist on
  `practice.miwa.care`. Don't add group-practice options to signup,
  billing, or onboarding flows without explicit instruction.
- Active plans: Trainee ($39), Associate ($69), Licensed Therapist
  ($129). Backend `VALID_PLANS` may still include `'group'` for
  legacy/internal use; the UI must not surface it.

## Codebase conventions

- **Frontend:** `client/src/pages/*.jsx` (React + Tailwind). Mobile
  variants live in `client/src/pages/mobile/`. Admin pages live in
  `client/src/pages/admin/` and use shared primitives from
  `client/src/components/admin/` (`AdminButton`, `AdminCard`,
  `AdminPageHeader`, `AdminStat`, `AdminStatusBadge`, `ConfirmModal`).
  See `client/src/components/admin/README.md` for the admin design
  pattern.
- **Backend:** `server/routes/*.js` (Express). The agent route lives
  at `server/routes/agent.js` as a thin entrypoint that delegates to
  modules under `server/routes/agent/`.
- **Database:** Production runs on **Azure Database for PostgreSQL**
  (Flexible Server). The codebase supports both adapters, gated by the
  `DB_PROVIDER` env var:
  - `DB_PROVIDER=postgres` — production. Uses
    `server/db/postgresAdapter.js` against `DATABASE_URL`.
  - `DB_PROVIDER=sqlite` — local dev / test fallback only. Uses
    `server/db.js` (sql.js, file persistence at `DB_PATH`).
  Schema migrations are append-only `ALTER TABLE ADD COLUMN` blocks
  applied through both adapters. Do not assume SQLite-only behavior in
  new code.
- **Patient schema:** `email`, `phone`, `sms_consent`, `session_modality`,
  `session_duration` are all on the `patients` table. New fields go
  through the migration block in `db.js` AND the destructure + UPDATE
  in `server/routes/patients.js` PUT handler.
- **Trainee onboarding wizard:** A five-screen flow at route
  `/t/welcome`, rendered outside `<Layout>` for a clean focused page.
  Trainees and associates with an incomplete wizard land here on
  every sign-in until they finish. Each `/t/*` page is wrapped in a
  `TraineeOnboardingGuard` that bounces partial trainees back to
  `/t/welcome` if they jump straight to a trainee URL.
  - **Frontend:** `client/src/pages/trainee/TraineeWelcome.jsx` is the
    single-file wizard; primitives live in
    `client/src/components/trainee/` (`TraineeButton`, `TraineeCard`,
    `WizardLayout`, `WizardProgress`). Mirror this primitives pattern
    for new trainee surfaces — don't reinvent.
  - **Backend:** routes are appended to `server/routes/onboarding.js`
    under `/api/onboarding/{state,step/:n,skip/:n,complete,
    school-email/verify-send,school-email/verify/:token,sample-case}`.
    All are auth-gated except the verify-by-token endpoint, which the
    trainee hits from their email client.
  - **State columns** (on `therapists`): `onboarding_step` (0 = not
    started, 1–5 = in progress, 6 = complete), `onboarded_at`,
    `onboarding_skipped_steps` (JSON array text), plus
    `expected_graduation_year` and `school_email_verified`.
  - **Supervisor info** persists to a new `trainee_supervisors` table.
    No outreach is sent — Miwa never emails a supervisor today; the
    data is stored for the trainee's own reference.
  - **Sample cases** are flagged on `patients.is_sample = 1` and show a
    small amber "Sample" badge in the patient list and pickers. The
    seeder lives in the `POST /api/onboarding/sample-case` route.

## Frontend tests

- Run `npm run test:client` for the Vitest + React Testing Library
  smoke suite in `client/src/__tests__/`. Covers auth, AI consult, and
  patient list flows. Keep it green on every PR; CI enforces.
