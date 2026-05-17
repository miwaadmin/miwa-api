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
- **Stripe webhooks:** `/api/billing/webhook` uses raw-body parsing,
  a dedicated generous rate limiter, `stripe_webhook_events` idempotency
  tracking, 500 responses on handler failures so Stripe can retry safely,
  and `event_logs` audit rows for signature failures. Preserve that
  pattern when adding webhook event types.
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
- **Trainee sidebar:** In Agency Companion / trainee mode, the sidebar
  order is fixed: Dashboard, Session Workspace, Consult, Supervision,
  Cases, Hours, Learning, Resources. Do not re-add Drafts or Transition;
  trainee drafting lives inside Session Workspace.
- **Session Workspace status pipeline:** The trainee copy-to-EHR workflow
  uses four steps: draft complete, trainee review, risk/safety check,
  copied to EHR. Surface this pipeline in Workspace list views and editor
  controls rather than rebuilding a separate Drafts page.
- **Feedback flow:** `POST /api/feedback` accepts `{ category, subject, message, context }`.
  Categories: `bug | feature_request | help | other` (legacy `feature` and `general` still
  accepted from the chat agent). Auth is handled inside the route using combined auth — it
  accepts either a therapist session (`miwa_auth` cookie) OR a client portal session
  (`miwa_client_auth` cookie). The mount in `server/index.js` has NO `requireAuth` middleware.
  Rate limited to 5 submissions per hour per user (DB-based). Returns `{ id, ticket_id }`
  where `ticket_id = 'MIWA-FB-<id>'`. Fires a founder notification email to `FOUNDER_EMAIL`
  env var (falls back to `ADMIN_EMAIL`). The `user_feedback` table has `subject TEXT`,
  `context_json TEXT`, and `client_account_id INTEGER` columns (added via ALTER TABLE in
  `runMigrations()`). Frontend component: `client/src/components/FeedbackModal.jsx` — wired
  into the therapist Sidebar footer, the trainee wizard footer, and Client portal Settings.
  Admin inbox (`AdminSupport.jsx`) has status + category filters and shows subject +
  context metadata on each card.
- **Client invite codes:** Associate and licensed clinicians ("clinician
  mode") can generate single-use `MIWA-XXXX-XXXX` portal invite codes from
  a patient chart. Codes live in `client_invites`, are redeemed through
  `POST /api/client-auth/redeem`, and link the client portal account back
  to the patient via `linked_patient_id`. Clinicians can also unlink a
  claimed portal account via `POST /api/client-invites/unlink`. This
  feature is gated to associate + licensed credential types; trainees must
  not see invite-code UI and will receive 403s from the invite API. Gate
  logic: `['associate', 'licensed'].includes(credential_type)` — the
  helper is `isClinician()` in `server/routes/client-invites.js`.
- **Trainee onboarding wizard:** A six-screen flow at route
  `/t/welcome`, rendered outside `<Layout>` for a clean focused page.
  Trainees and associates with an incomplete wizard land here on
  every sign-in until they finish. Each `/t/*` page is wrapped in a
  `TraineeOnboardingGuard` that bounces partial trainees back to
  `/t/welcome` if they jump straight to a trainee URL.
  Screen order: 1 Welcome + acknowledgment, 2 Introduce yourself to
  Miwa (soul profile), 3 School + program, 4 Hours tracking,
  5 Supervisor info, 6 First case.
  - **Frontend:** `client/src/pages/trainee/TraineeWelcome.jsx` is the
    single-file wizard; primitives live in
    `client/src/components/trainee/` (`TraineeButton`, `TraineeCard`,
    `WizardLayout`, `WizardProgress`). Mirror this primitives pattern
    for new trainee surfaces — don't reinvent.
  - **Soul screen (screen 2):** Collects 10 questions about the
    clinician's identity, style, and working preferences. On Next it
    fires POST `/api/onboarding/soul` as fire-and-forget (no loading
    state), then advances via PUT `/api/onboarding/step/2`. The shared
    answer formatter lives in `client/src/lib/soulFormatter.js` and is
    also used by `MiwaChat.jsx`'s chat-intro flow. If `soul_markdown`
    is already populated (from the wizard or a prior chat session),
    MiwaChat skips the chat-intro questionnaire entirely.
  - **Backend:** routes are appended to `server/routes/onboarding.js`
    under `/api/onboarding/{state,step/:n,skip/:n,complete,soul,
    school-email/verify-send,school-email/verify/:token,sample-case}`.
    All are auth-gated except the verify-by-token endpoint, which the
    trainee hits from their email client.
  - **State columns** (on `therapists`): `onboarding_step` (0 = not
    started, 1–6 = in progress, 7 = complete), `onboarded_at`,
    `onboarding_skipped_steps` (JSON array text), plus
    `expected_graduation_year` and `school_email_verified`.
    The complete sentinel is 7 (was 6 before the 6-screen model).
    Existing trainees with `onboarding_step` 1–6 are treated as
    in-progress (< 7); no migration is required.
  - **Supervisor info** persists to a new `trainee_supervisors` table.
    No outreach is sent — Miwa never emails a supervisor today; the
    data is stored for the trainee's own reference.
  - **Sample cases** are flagged on `patients.is_sample = 1` and show a
    small amber "Sample" badge in the patient list and pickers. The
    seeder lives in the `POST /api/onboarding/sample-case` route.

## Android permissions

Declared in `client/android/app/src/main/AndroidManifest.xml`. Do not
remove or narrow these without a product reason.

| Permission | Why |
|---|---|
| `INTERNET` | Core API calls |
| `RECORD_AUDIO` | Miwa Live voice (`getUserMedia` / WebRTC in MiwaChat.jsx) |
| `MODIFY_AUDIO_SETTINGS` | Audio routing for voice sessions |
| `CAMERA` | Document / intake photo capture |
| `READ_MEDIA_IMAGES` | Android 13+ image picker (API ≥ 33) |
| `READ_MEDIA_VIDEO` | Android 13+ video picker (API ≥ 33) |
| `READ_EXTERNAL_STORAGE` maxSdk=32 | Pre-Android-13 file read |
| `WRITE_EXTERNAL_STORAGE` maxSdk=29 | Pre-Android-10 file write |
| `POST_NOTIFICATIONS` | Local notification consent (API ≥ 33) |
| `VIBRATE` | Haptic feedback |

Camera is declared with `android:required="false"` so the app installs
on devices without a rear camera.

Capacitor plugins that back these permissions (all at v8.x, matching
`@capacitor/core`):
- `@capacitor/camera` — photo/video capture
- `@capacitor/filesystem` — read/write files in app sandbox
- `@capacitor/haptics` — vibration / haptic impact
- `@capacitor/local-notifications` — scheduled local alerts
- `@capacitor/preferences` — key-value storage (replaces Storage)

`@capacitor/push-notifications` is **Phase 2** (Firebase/FCM) — do not
install it until Phase 2 is scoped.

## iOS build pipeline (Codemagic → TestFlight)

- **Workflow:** `ios-capacitor` defined in `codemagic.yaml` at the repo root.
  Runs on Codemagic's `mac_mini_m2` instance, on demand from the Codemagic
  UI (auto-trigger on push is intentionally off to preserve the free-tier
  500 Mac-minutes/month).
- **iOS bundle ID:** `care.miwa.app` (set in
  `client/ios/App/App.xcodeproj/project.pbxproj`). This is **different**
  from the Android bundle ID `app.miwacare` and from
  `client/capacitor.config.json#appId` (which stays `app.miwacare` so
  `cap sync android` doesn't break the Play Store build). Do not change
  either ID.
- **App Store Connect app record:** "Miwa Care", Apple ID `6770142945`,
  SKU `care.miwa.app`.
- **Signing:** Uses the "Codemagic CI" App Store Connect API key
  integration. Each build generates a fresh RSA private key at
  `/tmp/distribution_key.pem` and calls
  `app-store-connect fetch-signing-files --create` to mint a new
  distribution certificate + App Store profile. Apple caps distribution
  certs at 2 — when builds fail with "Maximum number of certificates
  exceeded", revoke old distribution certs at
  developer.apple.com/account/resources/certificates/list and retry.
  (Long-term fix: upload a permanent `.p12` to Codemagic → Code Signing
  Identities and reuse it across builds.)
- **Build numbering:** `agvtool new-version -all "$BUILD_NUMBER"` sets a
  TestFlight-unique build number per run; marketing version comes from
  `MARKETING_VERSION` in the Xcode project.
- **Info.plist purpose strings** live in `client/ios/App/App/Info.plist`.
  Currently declared: `NSCameraUsageDescription`,
  `NSMicrophoneUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSPhotoLibraryAddUsageDescription`, `NSDocumentsFolderUsageDescription`.
  Add a matching `NS*UsageDescription` whenever a new Capacitor plugin
  touches a sensitive API or Apple will reject the upload with
  ITMS-90683.
- **TestFlight export compliance:** `ITSAppUsesNonExemptEncryption =
  false` is set in Info.plist so builds skip the "Missing Compliance"
  prompt automatically. This is the correct declaration for a Capacitor
  webview that uses only iOS-provided HTTPS — the app itself ships no
  cryptography. If a future feature ever bundles its own crypto
  (e.g. client-side AES, custom signing), flip this to `true` and
  fill out the App Encryption Documentation flow in App Store Connect.

## Frontend tests

- Run `npm run test:client` for the Vitest + React Testing Library
  smoke suite in `client/src/__tests__/`. Covers auth, AI consult, and
  patient list flows. Keep it green on every PR; CI enforces.
