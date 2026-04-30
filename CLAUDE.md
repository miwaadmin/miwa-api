# Miwa API — Project Notes for Claude

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
3. Commit with a short, intent-focused message + the standard
   `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` trailer
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

## Product direction (as of April 2026)

- **Solo therapist focus.** Group practice is intentionally NOT offered
  as a purchasable plan — it's a "Coming soon" waitlist on
  `practice.miwa.care`. Don't add group-practice options to signup,
  billing, or onboarding flows without explicit instruction.
- Active plans: Trainee ($39), Associate ($69), Licensed Therapist
  ($129). Backend `VALID_PLANS` may still include `'group'` for
  legacy/internal use; the UI must not surface it.

## Codebase conventions

- **Frontend:** `client/src/pages/*.jsx` (React + Tailwind). Mobile
  variants live in `client/src/pages/mobile/`.
- **Backend:** `server/routes/*.js` (Express). DB is SQLite via
  `server/db.js`; schema migrations are append-only `ALTER TABLE ADD
  COLUMN` blocks.
- **Patient schema:** `email`, `phone`, `sms_consent`, `session_modality`,
  `session_duration` are all on the `patients` table. New fields go
  through the migration block in `db.js` AND the destructure + UPDATE
  in `server/routes/patients.js` PUT handler.
