-- ─────────────────────────────────────────────────────────────────────────────
-- Miwa Postgres schema
--
-- Single source of truth for the Miwa Postgres database. Translated from the
-- legacy sql.js schema (CREATE TABLE + runMigrations consolidated). Idempotent
-- via IF NOT EXISTS so it is safe to re-run on every boot.
--
-- Type mapping vs. legacy:
--   INTEGER PRIMARY KEY AUTOINCREMENT  →  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
--   DATETIME                           →  TIMESTAMPTZ
--   DATETIME DEFAULT CURRENT_TIMESTAMP →  TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   REAL                               →  DOUBLE PRECISION
--
-- INTEGER booleans (0/1) and TEXT JSON columns are intentionally preserved so
-- existing call sites work unchanged. Migrate to BOOLEAN / JSONB later if
-- desired (single ALTER COLUMN per column).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ── Therapists (consolidated: base + every additive migration) ───────────────
CREATE TABLE IF NOT EXISTS therapists (
  id                            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                         TEXT UNIQUE NOT NULL,
  password_hash                 TEXT NOT NULL,
  first_name                    TEXT,
  last_name                     TEXT,
  full_name                     TEXT,
  user_role                     TEXT NOT NULL DEFAULT 'licensed',
  api_key                       TEXT,
  referral_code                 TEXT UNIQUE NOT NULL,
  referred_by                   BIGINT REFERENCES therapists(id),
  referred_by_code              TEXT,
  is_admin                      INTEGER NOT NULL DEFAULT 0,
  account_status                TEXT NOT NULL DEFAULT 'active',
  avatar_url                    TEXT,
  assistant_action_mode         TEXT NOT NULL DEFAULT 'draft_only',
  assistant_tone                TEXT,
  assistant_orientation         TEXT,
  assistant_verbosity           TEXT,
  assistant_memory              TEXT,
  assistant_permissions_json    TEXT,
  -- subscription
  subscription_status           TEXT NOT NULL DEFAULT 'trial',
  subscription_tier             TEXT,
  stripe_customer_id            TEXT,
  stripe_subscription_id        TEXT,
  workspace_uses                INTEGER NOT NULL DEFAULT 0,
  trial_limit                   INTEGER NOT NULL DEFAULT 10,
  -- timezone
  preferred_timezone            TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  -- credential verification
  credential_type               TEXT NOT NULL DEFAULT 'licensed',
  credential_number             TEXT,
  school_email                  TEXT,
  credential_verified           INTEGER NOT NULL DEFAULT 0,
  credential_verified_at        TIMESTAMPTZ,
  -- email verification
  email_verified                INTEGER NOT NULL DEFAULT 0,
  email_verified_at             TIMESTAMPTZ,
  telehealth_url                TEXT,
  -- group practice membership cache
  practice_id                   BIGINT,
  practice_role                 TEXT,
  -- AI budget
  ai_budget_monthly_cents       INTEGER,
  ai_budget_paused              INTEGER DEFAULT 0,
  -- training opt-out + onboarding + soul
  training_data_opt_out         INTEGER DEFAULT 0,
  onboarding_completed          INTEGER DEFAULT 0,
  soul_markdown                 TEXT,
  -- timestamps
  last_login_at                 TIMESTAMPTZ,
  last_seen_at                  TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_notes (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id        BIGINT NOT NULL REFERENCES therapists(id),
  author_therapist_id BIGINT REFERENCES therapists(id),
  note                TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_logs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id BIGINT REFERENCES therapists(id),
  event_type   TEXT NOT NULL,
  status       TEXT,
  message      TEXT,
  meta_json    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Patients (consolidated) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id                              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id                       TEXT NOT NULL,
  age                             INTEGER,
  gender                          TEXT,
  case_type                       TEXT,
  age_range                       TEXT,
  referral_source                 TEXT,
  living_situation                TEXT,
  presenting_concerns             TEXT,
  diagnoses                       TEXT,
  notes                           TEXT,
  client_overview                 TEXT,
  client_overview_signature       TEXT,
  mental_health_history           TEXT,
  substance_use                   TEXT,
  risk_screening                  TEXT,
  family_social_history           TEXT,
  mental_status_observations      TEXT,
  treatment_goals                 TEXT,
  medical_history                 TEXT,
  medications                     TEXT,
  trauma_history                  TEXT,
  strengths_protective_factors    TEXT,
  functional_impairments          TEXT,
  -- couple/family/souls
  client_type                     TEXT NOT NULL DEFAULT 'individual',
  members                         TEXT, -- JSON array string
  -- Miwa agent display + delivery
  display_name                    TEXT,
  phone                           TEXT,
  email                           TEXT,
  preferred_contact_method        TEXT DEFAULT 'sms',
  session_modality                TEXT DEFAULT 'in-person',
  session_duration                INTEGER DEFAULT 50,
  -- SMS consent (Twilio TFV)
  sms_consent                     INTEGER DEFAULT 0,
  sms_consent_at                  TIMESTAMPTZ,
  therapist_id                    BIGINT REFERENCES therapists(id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Sessions (consolidated) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id        BIGINT REFERENCES patients(id),
  therapist_id      BIGINT REFERENCES therapists(id),
  session_date      TEXT,
  note_format       TEXT NOT NULL DEFAULT 'SOAP',
  subjective        TEXT,
  objective         TEXT,
  assessment        TEXT,
  plan              TEXT,
  icd10_codes       TEXT,
  ai_feedback       TEXT,
  notes_json        TEXT,
  treatment_plan    TEXT,
  duration_minutes  INTEGER,
  cpt_code          TEXT,
  signed_at         TIMESTAMPTZ,
  full_note         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT REFERENCES therapists(id),
  role          TEXT NOT NULL,
  content       TEXT NOT NULL,
  context_type  TEXT,
  context_id    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Documents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id      BIGINT NOT NULL REFERENCES patients(id),
  therapist_id    BIGINT REFERENCES therapists(id),
  original_name   TEXT NOT NULL,
  file_type       TEXT NOT NULL,
  document_label  TEXT,
  document_kind   TEXT NOT NULL DEFAULT 'record',
  extracted_text  TEXT,
  file_path       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Assessments (consolidated incl. member_label) ────────────────────────────
CREATE TABLE IF NOT EXISTS assessments (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id               BIGINT NOT NULL REFERENCES patients(id),
  therapist_id             BIGINT NOT NULL REFERENCES therapists(id),
  template_type            TEXT NOT NULL,
  session_id               BIGINT REFERENCES sessions(id),
  administered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responses                TEXT NOT NULL,
  total_score              INTEGER,
  severity_level           TEXT,
  severity_color           TEXT,
  baseline_score           INTEGER,
  previous_score           INTEGER,
  score_change             INTEGER,
  is_improvement           INTEGER DEFAULT 0,
  is_deterioration         INTEGER DEFAULT 0,
  clinically_significant   INTEGER DEFAULT 0,
  risk_flags               TEXT,
  status                   TEXT NOT NULL DEFAULT 'completed',
  notes                    TEXT,
  member_label             TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Appointments (consolidated incl. attendance + Meet + display name) ───────
CREATE TABLE IF NOT EXISTS appointments (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id          BIGINT NOT NULL REFERENCES therapists(id),
  patient_id            BIGINT NOT NULL REFERENCES patients(id),
  client_code           TEXT NOT NULL,
  appointment_type      TEXT NOT NULL,
  scheduled_start       TEXT,
  scheduled_end         TEXT,
  duration_minutes      INTEGER NOT NULL DEFAULT 50,
  location              TEXT,
  notes                 TEXT,
  calendar_provider     TEXT NOT NULL DEFAULT 'internal',
  google_calendar_id    TEXT,
  google_event_id       TEXT,
  sync_status           TEXT NOT NULL DEFAULT 'internal',
  sync_error            TEXT,
  last_synced_at        TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'scheduled',
  attendance_status     TEXT DEFAULT 'pending',
  checked_in_at         TIMESTAMPTZ,
  minutes_late          INTEGER DEFAULT 0,
  attendance_notes      TEXT,
  mbc_auto_sent         INTEGER DEFAULT 0,
  client_display_name   TEXT,
  meet_url              TEXT,
  meet_event_id         TEXT,
  meet_space_name       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  kind          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_reports (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  patient_id    BIGINT NOT NULL REFERENCES patients(id),
  title         TEXT NOT NULL,
  audience      TEXT,
  purpose       TEXT,
  report_json   TEXT,
  pdf_path      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Background agent tasks
CREATE TABLE IF NOT EXISTS agent_tasks (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id      BIGINT NOT NULL REFERENCES therapists(id),
  title             TEXT NOT NULL,
  prompt            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued',
  result_text       TEXT,
  result_json       TEXT,
  error_message     TEXT,
  iterations        INTEGER NOT NULL DEFAULT 0,
  tool_calls_json   TEXT,
  cost_cents        INTEGER NOT NULL DEFAULT 0,
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS progress_alerts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id      BIGINT NOT NULL REFERENCES patients(id),
  therapist_id    BIGINT NOT NULL REFERENCES therapists(id),
  type            TEXT NOT NULL,
  severity        TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  assessment_id   BIGINT REFERENCES assessments(id),
  is_read         INTEGER NOT NULL DEFAULT 0,
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outcome_supervision_notes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id    BIGINT NOT NULL REFERENCES patients(id),
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  author_id     BIGINT NOT NULL REFERENCES therapists(id),
  assessment_id BIGINT REFERENCES assessments(id),
  note_text     TEXT NOT NULL,
  note_type     TEXT NOT NULL DEFAULT 'observation',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_links (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token           TEXT UNIQUE NOT NULL,
  patient_id      BIGINT NOT NULL REFERENCES patients(id),
  therapist_id    BIGINT NOT NULL REFERENCES therapists(id),
  template_type   TEXT NOT NULL,
  member_label    TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  assessment_id   BIGINT REFERENCES assessments(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proactive_alerts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  patient_id    BIGINT NOT NULL REFERENCES patients(id),
  alert_type    TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'LOW',
  title         TEXT NOT NULL,
  description   TEXT,
  metric_value  DOUBLE PRECISION,
  is_read       INTEGER NOT NULL DEFAULT 0,
  dismissed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proactive_alerts_therapist_created ON proactive_alerts(therapist_id, created_at);
CREATE INDEX IF NOT EXISTS idx_proactive_alerts_dismissed         ON proactive_alerts(dismissed_at);

CREATE TABLE IF NOT EXISTS research_briefs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  brief_type    TEXT NOT NULL DEFAULT 'weekly',
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  articles_json TEXT,
  topics_json   TEXT,
  sent_email    INTEGER DEFAULT 0,
  saved         INTEGER DEFAULT 0,
  opened_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id    BIGINT NOT NULL REFERENCES therapists(id),
  name            TEXT NOT NULL,
  trigger_type    TEXT NOT NULL,
  trigger_config  TEXT NOT NULL DEFAULT '{}',
  action_type     TEXT NOT NULL,
  action_config   TEXT NOT NULL DEFAULT '{}',
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_fired_at   TIMESTAMPTZ,
  fire_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mental_health_news (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  source        TEXT,
  published_at  TEXT,
  summary       TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mh_news_fetched ON mental_health_news (fetched_at DESC);

CREATE TABLE IF NOT EXISTS therapist_preferences (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id      BIGINT NOT NULL REFERENCES therapists(id),
  category          TEXT NOT NULL,
  key               TEXT NOT NULL,
  value             TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'inferred',
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  last_observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(therapist_id, category, key)
);
CREATE INDEX IF NOT EXISTS idx_prefs_therapist ON therapist_preferences(therapist_id, category);

CREATE TABLE IF NOT EXISTS checkin_links (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token         TEXT UNIQUE NOT NULL,
  patient_id    BIGINT NOT NULL REFERENCES patients(id),
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  message       TEXT,
  send_at       TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  completed_at  TIMESTAMPTZ,
  mood_score    INTEGER,
  mood_notes    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checkin_therapist ON checkin_links(therapist_id, created_at);
CREATE INDEX IF NOT EXISTS idx_checkin_patient   ON checkin_links(patient_id, created_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token         TEXT UNIQUE NOT NULL,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token         TEXT UNIQUE NOT NULL,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credential_verifications (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  token         TEXT UNIQUE NOT NULL,
  verify_email  TEXT NOT NULL,
  verified_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Agentic pillars ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_briefs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id    BIGINT NOT NULL REFERENCES therapists(id),
  patient_id      BIGINT NOT NULL REFERENCES patients(id),
  appointment_id  BIGINT REFERENCES appointments(id),
  brief_json      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'generated',
  viewed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_briefs_therapist   ON session_briefs(therapist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefs_appointment ON session_briefs(appointment_id);

CREATE TABLE IF NOT EXISTS generated_documents (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id    BIGINT NOT NULL REFERENCES therapists(id),
  patient_id      BIGINT NOT NULL REFERENCES patients(id),
  template_id     TEXT NOT NULL,
  template_name   TEXT NOT NULL,
  title           TEXT,
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',
  metadata_json   TEXT,
  finalized_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gendocs_therapist ON generated_documents(therapist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gendocs_patient   ON generated_documents(patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS therapist_contacts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  name          TEXT NOT NULL,
  title         TEXT,
  agency        TEXT,
  specialty     TEXT,
  email         TEXT,
  phone         TEXT,
  category      TEXT NOT NULL DEFAULT 'other',
  notes         TEXT,
  pinned        INTEGER NOT NULL DEFAULT 0,
  shared        INTEGER NOT NULL DEFAULT 0,
  public        INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_therapist ON therapist_contacts(therapist_id, pinned DESC, name ASC);
CREATE INDEX IF NOT EXISTS idx_contacts_category  ON therapist_contacts(therapist_id, category);
CREATE INDEX IF NOT EXISTS idx_contacts_public    ON therapist_contacts(public, name ASC);

CREATE TABLE IF NOT EXISTS style_samples (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  session_id    BIGINT REFERENCES sessions(id),
  source        TEXT NOT NULL,
  field         TEXT,
  ai_draft      TEXT NOT NULL,
  final_text    TEXT NOT NULL,
  edit_distance INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_style_samples_therapist ON style_samples(therapist_id, created_at DESC);

CREATE TABLE IF NOT EXISTS therapist_style_profile (
  therapist_id        BIGINT PRIMARY KEY REFERENCES therapists(id),
  sample_count        INTEGER NOT NULL DEFAULT 0,
  hints_text          TEXT,
  prefer_phrases_json TEXT,
  avoid_phrases_json  TEXT,
  avg_length_ratio    DOUBLE PRECISION,
  formality           TEXT,
  last_rebuild_at     TIMESTAMPTZ,
  last_rebuild_count  INTEGER,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflows (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  workflow_type TEXT NOT NULL,
  label         TEXT,
  status        TEXT NOT NULL DEFAULT 'planning',
  steps_json    TEXT NOT NULL DEFAULT '[]',
  current_step  INTEGER NOT NULL DEFAULT 0,
  context_json  TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workflows_therapist ON workflows(therapist_id, status);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id       BIGINT NOT NULL REFERENCES workflows(id),
  step_number       INTEGER NOT NULL,
  tool_name         TEXT NOT NULL,
  args_json         TEXT NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'pending',
  result_json       TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approved_at       TIMESTAMPTZ,
  error             TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wf_steps_workflow ON workflow_steps(workflow_id, step_number);

CREATE TABLE IF NOT EXISTS treatment_plans (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id        BIGINT NOT NULL REFERENCES patients(id),
  therapist_id      BIGINT NOT NULL REFERENCES therapists(id),
  status            TEXT NOT NULL DEFAULT 'active',
  summary           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reviewed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tx_plans_patient ON treatment_plans(patient_id, status);

CREATE TABLE IF NOT EXISTS treatment_goals (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id             BIGINT NOT NULL REFERENCES treatment_plans(id),
  goal_text           TEXT NOT NULL,
  target_metric       TEXT,
  baseline_value      DOUBLE PRECISION,
  current_value       DOUBLE PRECISION,
  status              TEXT NOT NULL DEFAULT 'active',
  interventions_json  TEXT DEFAULT '[]',
  progress_notes_json TEXT DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  met_at              TIMESTAMPTZ,
  revised_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tx_goals_plan ON treatment_goals(plan_id, status);

CREATE TABLE IF NOT EXISTS treatment_plan_revisions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id           BIGINT NOT NULL REFERENCES treatment_plans(id),
  therapist_id      BIGINT NOT NULL REFERENCES therapists(id),
  patient_id        BIGINT REFERENCES patients(id),
  revision_num      INTEGER NOT NULL,
  snapshot_json     TEXT NOT NULL,
  change_kind       TEXT NOT NULL,
  change_detail     TEXT,
  author_kind       TEXT NOT NULL DEFAULT 'therapist',
  author_id         BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tp_revisions_plan    ON treatment_plan_revisions(plan_id, revision_num);
CREATE INDEX IF NOT EXISTS idx_tp_revisions_patient ON treatment_plan_revisions(patient_id, created_at);

CREATE TABLE IF NOT EXISTS delegated_tasks (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id      BIGINT NOT NULL REFERENCES therapists(id),
  parent_message_id BIGINT,
  goal              TEXT NOT NULL,
  scope             TEXT,
  status            TEXT NOT NULL DEFAULT 'running',
  model_used        TEXT,
  result_json       TEXT,
  tokens_used       INTEGER DEFAULT 0,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_delegated_therapist ON delegated_tasks(therapist_id, status);

CREATE TABLE IF NOT EXISTS practice_insights (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id      BIGINT NOT NULL REFERENCES therapists(id),
  insight_type      TEXT NOT NULL,
  insight_text      TEXT NOT NULL,
  evidence_json     TEXT DEFAULT '[]',
  confidence_score  DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  patient_ids_json  TEXT DEFAULT '[]',
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_insights_therapist ON practice_insights(therapist_id, insight_type, is_active);

CREATE TABLE IF NOT EXISTS outreach_rules (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id      BIGINT NOT NULL REFERENCES therapists(id),
  rule_type         TEXT NOT NULL,
  label             TEXT,
  config_json       TEXT NOT NULL DEFAULT '{}',
  enabled           INTEGER NOT NULL DEFAULT 1,
  last_executed_at  TIMESTAMPTZ,
  execute_count     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_rules_therapist ON outreach_rules(therapist_id, enabled);

CREATE TABLE IF NOT EXISTS outreach_log (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id    BIGINT NOT NULL REFERENCES therapists(id),
  patient_id      BIGINT NOT NULL REFERENCES patients(id),
  rule_id         BIGINT REFERENCES outreach_rules(id),
  outreach_type   TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'sms',
  message_preview TEXT,
  status          TEXT NOT NULL DEFAULT 'sent',
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_log_therapist ON outreach_log(therapist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_log_patient   ON outreach_log(patient_id, created_at DESC);

-- ── Group practice multi-tenancy ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS practices (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                    TEXT NOT NULL,
  slug                    TEXT UNIQUE NOT NULL,
  owner_id                BIGINT NOT NULL REFERENCES therapists(id),
  logo_url                TEXT,
  address                 TEXT,
  phone                   TEXT,
  email                   TEXT,
  npi_number              TEXT,
  tax_id                  TEXT,
  stripe_subscription_id  TEXT,
  max_clinicians          INTEGER NOT NULL DEFAULT 3,
  settings_json           TEXT DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_members (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id   BIGINT NOT NULL REFERENCES practices(id),
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  role          TEXT NOT NULL DEFAULT 'clinician',
  status        TEXT NOT NULL DEFAULT 'active',
  invited_by    BIGINT REFERENCES therapists(id),
  invite_token  TEXT UNIQUE,
  invited_at    TIMESTAMPTZ,
  joined_at     TIMESTAMPTZ,
  removed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(practice_id, therapist_id)
);
CREATE INDEX IF NOT EXISTS idx_pm_practice  ON practice_members(practice_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_therapist ON practice_members(therapist_id);

CREATE TABLE IF NOT EXISTS supervision_links (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id     BIGINT NOT NULL REFERENCES practices(id),
  supervisor_id   BIGINT NOT NULL REFERENCES therapists(id),
  supervisee_id   BIGINT NOT NULL REFERENCES therapists(id),
  access_level    TEXT NOT NULL DEFAULT 'read_notes',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(practice_id, supervisor_id, supervisee_id)
);

CREATE TABLE IF NOT EXISTS shared_patients (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id     BIGINT NOT NULL REFERENCES practices(id),
  patient_id      BIGINT NOT NULL REFERENCES patients(id),
  shared_with_id  BIGINT NOT NULL REFERENCES therapists(id),
  shared_by_id    BIGINT NOT NULL REFERENCES therapists(id),
  access_level    TEXT NOT NULL DEFAULT 'read',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(patient_id, shared_with_id)
);

CREATE TABLE IF NOT EXISTS practice_templates (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id     BIGINT NOT NULL REFERENCES practices(id),
  created_by      BIGINT NOT NULL REFERENCES therapists(id),
  template_type   TEXT NOT NULL,
  name            TEXT NOT NULL,
  content_json    TEXT NOT NULL,
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_messages (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id   BIGINT NOT NULL REFERENCES practices(id),
  author_id     BIGINT NOT NULL REFERENCES therapists(id),
  message_type  TEXT NOT NULL DEFAULT 'announcement',
  title         TEXT,
  content       TEXT NOT NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS note_enrichments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id      BIGINT NOT NULL REFERENCES sessions(id),
  therapist_id    BIGINT NOT NULL REFERENCES therapists(id),
  enrichment_type TEXT NOT NULL,
  content_json    TEXT NOT NULL,
  accepted        INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_enrichments_session ON note_enrichments(session_id);

-- ── Tier 1 agentic upgrades ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id        BIGINT NOT NULL REFERENCES therapists(id),
  summary             TEXT NOT NULL,
  messages_compressed INTEGER NOT NULL DEFAULT 0,
  token_estimate      INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_scheduled_tasks (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id    BIGINT NOT NULL REFERENCES therapists(id),
  task_type       TEXT NOT NULL DEFAULT 'reminder',
  description     TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  recurring       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  result          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_scheduled ON agent_scheduled_tasks(status, scheduled_for);

CREATE TABLE IF NOT EXISTS background_tasks (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  task_type     TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  progress      INTEGER DEFAULT 0,
  result_json   TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bg_tasks ON background_tasks(therapist_id, status);

CREATE TABLE IF NOT EXISTS event_triggers (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  event_type    TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  config_json   TEXT DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1,
  fire_count    INTEGER NOT NULL DEFAULT 0,
  last_fired_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_triggers ON event_triggers(event_type, enabled);

-- ── Client portal ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_portal_tokens (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token             TEXT UNIQUE NOT NULL,
  patient_id        BIGINT NOT NULL REFERENCES patients(id),
  therapist_id      BIGINT NOT NULL REFERENCES therapists(id),
  expires_at        TIMESTAMPTZ NOT NULL,
  last_accessed_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_tokens ON client_portal_tokens(token);

CREATE TABLE IF NOT EXISTS client_messages (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id    BIGINT NOT NULL REFERENCES patients(id),
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  sender        TEXT NOT NULL DEFAULT 'client',
  message       TEXT NOT NULL,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_msgs ON client_messages(patient_id, created_at);

-- ── Misc / late-stage tables ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_feedback (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id    BIGINT REFERENCES therapists(id),
  message         TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  source          TEXT NOT NULL DEFAULT 'chat',
  status          TEXT NOT NULL DEFAULT 'new',
  admin_response  TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cost_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT REFERENCES therapists(id),
  kind          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ok',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cost_events_therapist ON cost_events(therapist_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_events_month     ON cost_events(created_at);

CREATE TABLE IF NOT EXISTS daily_briefings (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT NOT NULL REFERENCES therapists(id),
  local_date    TEXT NOT NULL,
  markdown      TEXT NOT NULL,
  stats_json    TEXT,
  narrative     TEXT,
  caseload_json TEXT,
  emailed_at    TIMESTAMPTZ,
  opened_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(therapist_id, local_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_briefings_therapist_date ON daily_briefings(therapist_id, local_date);

CREATE TABLE IF NOT EXISTS training_trajectories (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id      BIGINT NOT NULL REFERENCES therapists(id),
  session_token     TEXT,
  model             TEXT,
  conversation_json TEXT NOT NULL,
  tool_calls_count  INTEGER DEFAULT 0,
  turn_completed    INTEGER DEFAULT 0,
  rating            TEXT,
  rating_note       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_traj_therapist ON training_trajectories(therapist_id, created_at);
CREATE INDEX IF NOT EXISTS idx_traj_session   ON training_trajectories(session_token);

CREATE INDEX IF NOT EXISTS idx_tasks_therapist ON agent_tasks(therapist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON agent_tasks(status, created_at);

CREATE TABLE IF NOT EXISTS phi_access_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id  BIGINT,
  action        TEXT NOT NULL,
  resource      TEXT NOT NULL,
  patient_id    BIGINT,
  method        TEXT,
  status_code   INTEGER,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phi_log_therapist ON phi_access_log(therapist_id, created_at);
CREATE INDEX IF NOT EXISTS idx_phi_log_patient   ON phi_access_log(patient_id, created_at);

CREATE TABLE IF NOT EXISTS scheduled_sends (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  therapist_id    BIGINT NOT NULL REFERENCES therapists(id),
  patient_id      BIGINT NOT NULL REFERENCES patients(id),
  assessment_type TEXT NOT NULL,
  token           TEXT NOT NULL,
  phone           TEXT NOT NULL,
  send_at         TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  sent_at         TIMESTAMPTZ,
  error           TEXT,
  custom_message  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
