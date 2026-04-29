const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'mftbrain.db');
const DB_PROVIDER = String(process.env.DB_PROVIDER || 'sqlite').toLowerCase();

let db = null;
let SqlJs = null;

async function initDb() {
  if (DB_PROVIDER === 'postgres' || DB_PROVIDER === 'postgresql') {
    throw new Error('DB_PROVIDER=postgres is configured, but the Miwa runtime is still using the SQLite adapter. Run the PostgreSQL runtime cutover before enabling this setting.');
  }

  if (db) return db;

  SqlJs = await initSqlJs();

  // Refuse to silently nuke an existing-but-unreadable DB file. If the file
  // exists with non-trivial content but sql.js can't open it, that's almost
  // certainly a half-written / corrupted persist (e.g. SIGTERM mid-write
  // during a forced redeploy). In that case we hard-fail boot rather than
  // letting the empty in-memory DB get persist()-ed back over the bad file
  // and lock in the data loss. The file is then safe to recover or
  // hand-inspect via `_diag/db`.
  let fileBuffer = null;
  let fileExists = false;
  let fileSize = 0;
  if (fs.existsSync(DB_PATH)) {
    fileExists = true;
    try {
      const stat = fs.statSync(DB_PATH);
      fileSize = stat.size;
    } catch {}
    try {
      fileBuffer = fs.readFileSync(DB_PATH);
    } catch (err) {
      throw new Error(`[db] DB_PATH ${DB_PATH} exists but could not be read: ${err.message}. Refusing to start to avoid overwriting it.`);
    }
  }

  // SQLite file header is "SQLite format 3\u0000" (16 bytes). An empty buffer
  // (0 bytes) is OK — that's a never-initialised file. A non-empty buffer
  // with a wrong header means corruption; bail out before we replace it.
  if (fileBuffer && fileBuffer.length > 0) {
    const header = fileBuffer.slice(0, 16).toString('utf8');
    if (!header.startsWith('SQLite format 3')) {
      throw new Error(`[db] DB_PATH ${DB_PATH} (${fileSize} bytes) does not look like a valid SQLite file. Refusing to start to avoid overwriting it. Inspect /data manually before retrying.`);
    }
    try {
      db = new SqlJs.Database(fileBuffer);
    } catch (err) {
      throw new Error(`[db] Failed to open ${DB_PATH} (${fileSize} bytes): ${err.message}. Refusing to start so the bad file isn't overwritten.`);
    }
  } else {
    db = new SqlJs.Database();
    if (fileExists) {
      console.warn(`[db] WARNING: ${DB_PATH} exists but is empty — initialising fresh DB.`);
    } else {
      console.log(`[db] No existing DB at ${DB_PATH} — initialising fresh DB.`);
    }
  }

  db.run('PRAGMA foreign_keys = ON;');

  createSchema();
  runMigrations();
  return db;
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS therapists (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name    TEXT,
      last_name     TEXT,
      full_name     TEXT,
      user_role     TEXT NOT NULL DEFAULT 'licensed',
      api_key       TEXT,
      referral_code TEXT UNIQUE NOT NULL,
      referred_by   INTEGER REFERENCES therapists(id),
      referred_by_code TEXT,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      account_status TEXT NOT NULL DEFAULT 'active',
      avatar_url    TEXT,
      assistant_action_mode TEXT NOT NULL DEFAULT 'draft_only',
      assistant_tone TEXT,
      assistant_orientation TEXT,
      assistant_verbosity TEXT,
      assistant_memory TEXT,
      assistant_permissions_json TEXT,
      last_login_at DATETIME,
      last_seen_at  DATETIME,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      author_therapist_id INTEGER REFERENCES therapists(id),
      note TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER REFERENCES therapists(id),
      event_type TEXT NOT NULL,
      status TEXT,
      message TEXT,
      meta_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      age INTEGER,
      gender TEXT,
      case_type TEXT,
      age_range TEXT,
      referral_source TEXT,
      living_situation TEXT,
      presenting_concerns TEXT,
      diagnoses TEXT,
      notes TEXT,
      client_overview TEXT,
      client_overview_signature TEXT,
      mental_health_history TEXT,
      substance_use TEXT,
      risk_screening TEXT,
      family_social_history TEXT,
      mental_status_observations TEXT,
      treatment_goals TEXT,
      medical_history TEXT,
      medications TEXT,
      trauma_history TEXT,
      strengths_protective_factors TEXT,
      functional_impairments TEXT,
      therapist_id INTEGER REFERENCES therapists(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER,
      therapist_id INTEGER REFERENCES therapists(id),
      session_date TEXT,
      note_format TEXT NOT NULL DEFAULT 'SOAP',
      subjective TEXT,
      objective TEXT,
      assessment TEXT,
      plan TEXT,
      icd10_codes TEXT,
      ai_feedback TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER REFERENCES therapists(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      context_type TEXT,
      context_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      therapist_id INTEGER REFERENCES therapists(id),
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      document_label TEXT,
      document_kind TEXT NOT NULL DEFAULT 'record',
      extracted_text TEXT,
      file_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      template_type TEXT NOT NULL,
      session_id INTEGER REFERENCES sessions(id),
      administered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      responses TEXT NOT NULL,
      total_score INTEGER,
      severity_level TEXT,
      severity_color TEXT,
      baseline_score INTEGER,
      previous_score INTEGER,
      score_change INTEGER,
      is_improvement INTEGER DEFAULT 0,
      is_deterioration INTEGER DEFAULT 0,
      clinically_significant INTEGER DEFAULT 0,
      risk_flags TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      client_code TEXT NOT NULL,
      appointment_type TEXT NOT NULL,
      scheduled_start TEXT,
      scheduled_end TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 50,
      location TEXT,
      notes TEXT,
      calendar_provider TEXT NOT NULL DEFAULT 'internal',
      google_calendar_id TEXT,
      google_event_id TEXT,
      sync_status TEXT NOT NULL DEFAULT 'internal',
      sync_error TEXT,
      last_synced_at DATETIME,
      status TEXT NOT NULL DEFAULT 'scheduled',
      practicum_bucket_override TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS agent_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      title TEXT NOT NULL,
      audience TEXT,
      purpose TEXT,
      report_json TEXT,
      pdf_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Background agent tasks — the "delegate and walk away" layer.
    -- A task is a message the user sends Miwa with the instruction to run
    -- asynchronously. A worker (services/task-runner.js) picks up rows where
    -- status='queued' and runs the agent loop without an open HTTP connection.
    -- Results are stored here and the user is notified via the task inbox UI.
    --
    -- Safety rails enforced in task-runner.js:
    --   • Read-only + safe-write tools only (no SMS/email/data deletion)
    --   • Max iterations: 20
    --   • Max runtime: 15 min
    --   • Respects therapists.ai_budget_monthly_cents via existing cost router
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      title TEXT NOT NULL,                   -- short label for UI chip
      prompt TEXT NOT NULL,                  -- user's original message
      status TEXT NOT NULL DEFAULT 'queued', -- queued|running|done|failed|cancelled
      result_text TEXT,                      -- final assistant response
      result_json TEXT,                      -- optional structured payload
      error_message TEXT,                    -- populated if status='failed'
      iterations INTEGER NOT NULL DEFAULT 0,
      tool_calls_json TEXT,                  -- scrubbed log of tool invocations
      cost_cents INTEGER NOT NULL DEFAULT 0,
      read_at DATETIME,                      -- null while unread (drives badge)
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS progress_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      assessment_id INTEGER REFERENCES assessments(id),
      is_read INTEGER NOT NULL DEFAULT 0,
      dismissed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS outcome_supervision_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      author_id INTEGER NOT NULL REFERENCES therapists(id),
      assessment_id INTEGER REFERENCES assessments(id),
      note_text TEXT NOT NULL,
      note_type TEXT NOT NULL DEFAULT 'observation',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assessment_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      template_type TEXT NOT NULL,
      member_label TEXT,
      expires_at DATETIME NOT NULL,
      completed_at DATETIME,
      assessment_id INTEGER REFERENCES assessments(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proactive_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'LOW',
      title TEXT NOT NULL,
      description TEXT,
      metric_value REAL,
      is_read INTEGER NOT NULL DEFAULT 0,
      dismissed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS research_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      brief_type TEXT NOT NULL DEFAULT 'weekly',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      articles_json TEXT,
      topics_json TEXT,
      local_date TEXT,
      timezone TEXT,
      sent_email INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS automation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL DEFAULT '{}',
      action_type TEXT NOT NULL,
      action_config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_fired_at DATETIME,
      fire_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mental_health_news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      source TEXT,
      published_at TEXT,
      summary TEXT,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_mh_news_fetched ON mental_health_news (fetched_at DESC);

    CREATE TABLE IF NOT EXISTS therapist_preferences (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id     INTEGER NOT NULL REFERENCES therapists(id),
      category         TEXT NOT NULL,
      key              TEXT NOT NULL,
      value            TEXT NOT NULL,
      source           TEXT NOT NULL DEFAULT 'inferred',
      confidence       REAL NOT NULL DEFAULT 1.0,
      last_observed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(therapist_id, category, key)
    );
    CREATE INDEX IF NOT EXISTS idx_prefs_therapist ON therapist_preferences(therapist_id, category);

    CREATE TABLE IF NOT EXISTS checkin_links (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      token        TEXT UNIQUE NOT NULL,
      patient_id   INTEGER NOT NULL REFERENCES patients(id),
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      message      TEXT,
      send_at      DATETIME,
      sent_at      DATETIME,
      expires_at   DATETIME NOT NULL,
      completed_at DATETIME,
      mood_score   INTEGER,
      mood_notes   TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_checkin_therapist ON checkin_links(therapist_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_checkin_patient ON checkin_links(patient_id, created_at);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token      TEXT UNIQUE NOT NULL,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      expires_at DATETIME NOT NULL,
      used_at    DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      token        TEXT UNIQUE NOT NULL,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      expires_at   DATETIME NOT NULL,
      used_at      DATETIME,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- AGENTIC PILLARS — Hermes-level autonomous clinical intelligence
    -- ═══════════════════════════════════════════════════════════════════════

    -- Pillar 1: Pre-Session Briefs — auto-generated before each appointment
    CREATE TABLE IF NOT EXISTS session_briefs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      patient_id      INTEGER NOT NULL REFERENCES patients(id),
      appointment_id  INTEGER REFERENCES appointments(id),
      brief_json      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'generated',
      viewed_at       DATETIME,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_briefs_therapist ON session_briefs(therapist_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_briefs_appointment ON session_briefs(appointment_id);

    -- Clinical letters / forms / documents generated from chart data (ESA letters,
    -- school accommodation requests, attorney summaries, insurance pre-auth,
    -- return-to-work letters, treatment summaries). Drafts are editable; once
    -- finalized the therapist can export or attach the sign-off timestamp.
    CREATE TABLE IF NOT EXISTS generated_documents (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      patient_id      INTEGER NOT NULL REFERENCES patients(id),
      template_id     TEXT    NOT NULL,
      template_name   TEXT    NOT NULL,
      title           TEXT,
      content         TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'draft', -- draft, finalized, sent
      metadata_json   TEXT,
      finalized_at    DATETIME,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gendocs_therapist ON generated_documents(therapist_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gendocs_patient ON generated_documents(patient_id, created_at DESC);

    -- Trusted professional contacts — a therapist-maintained referral network
    -- of people (not organizations). Detectives, psychiatrists, attorneys,
    -- advocates, supervisors, other therapists for consultation. Each contact
    -- is scoped to one therapist (private), with an optional shared flag
    -- reserved for practice-wide visibility once Miwa for Teams ships.
    CREATE TABLE IF NOT EXISTS therapist_contacts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id   INTEGER NOT NULL REFERENCES therapists(id),
      name           TEXT    NOT NULL,
      title          TEXT,                -- "Detective, DV/SA Unit"
      agency         TEXT,                -- "LAPD" / "Kaiser" / "Private practice"
      specialty      TEXT,                -- "IPV / sexual assault cases"
      email          TEXT,
      phone          TEXT,
      category       TEXT NOT NULL DEFAULT 'other',  -- law_enforcement | psychiatry | legal | advocacy | medical | housing | supervision | other
      notes          TEXT,                -- "Responds within 24h. Good for urgent DV referrals."
      pinned         INTEGER NOT NULL DEFAULT 0,
      shared         INTEGER NOT NULL DEFAULT 0,     -- reserved for practice-team visibility
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_therapist ON therapist_contacts(therapist_id, pinned DESC, name ASC);
    CREATE INDEX IF NOT EXISTS idx_contacts_category ON therapist_contacts(therapist_id, category);

    -- Per-edit style samples: each row captures one AI-draft → therapist-saved
    -- pair so Miwa can learn each clinician's voice. Drives a periodically
    -- rebuilt style profile that gets injected into future note-generation
    -- prompts. Both sides are PHI-laden; already protected by the same auth
    -- + encryption as sessions.
    CREATE TABLE IF NOT EXISTS style_samples (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id   INTEGER NOT NULL REFERENCES therapists(id),
      session_id     INTEGER REFERENCES sessions(id),
      source         TEXT NOT NULL,      -- 'dictate' | 'convert' | 'manual'
      field          TEXT,               -- 'subjective' | 'objective' | 'assessment' | 'plan' | null
      ai_draft       TEXT NOT NULL,
      final_text     TEXT NOT NULL,
      edit_distance  INTEGER,            -- approximate char-level diff size
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_style_samples_therapist ON style_samples(therapist_id, created_at DESC);

    -- Distilled per-therapist style profile — rebuilt every N new samples.
    CREATE TABLE IF NOT EXISTS therapist_style_profile (
      therapist_id        INTEGER PRIMARY KEY REFERENCES therapists(id),
      sample_count        INTEGER NOT NULL DEFAULT 0,
      hints_text          TEXT,
      prefer_phrases_json TEXT,
      avoid_phrases_json  TEXT,
      avg_length_ratio    REAL,
      formality           TEXT,              -- 'clinical' | 'warm' | 'mixed'
      last_rebuild_at     DATETIME,
      last_rebuild_count  INTEGER,           -- sample_count at last rebuild
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Pillar 2: Workflow Engine — multi-step autonomous task chains
    CREATE TABLE IF NOT EXISTS workflows (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      workflow_type   TEXT NOT NULL,
      label           TEXT,
      status          TEXT NOT NULL DEFAULT 'planning',
      steps_json      TEXT NOT NULL DEFAULT '[]',
      current_step    INTEGER NOT NULL DEFAULT 0,
      context_json    TEXT,
      error           TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at    DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_workflows_therapist ON workflows(therapist_id, status);

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id      INTEGER NOT NULL REFERENCES workflows(id),
      step_number      INTEGER NOT NULL,
      tool_name        TEXT NOT NULL,
      args_json        TEXT NOT NULL DEFAULT '{}',
      status           TEXT NOT NULL DEFAULT 'pending',
      result_json      TEXT,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      approved_at      DATETIME,
      error            TEXT,
      started_at       DATETIME,
      completed_at     DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_wf_steps_workflow ON workflow_steps(workflow_id, step_number);

    -- Pillar 3: Treatment Plan Agent — living, evolving treatment plans
    CREATE TABLE IF NOT EXISTS treatment_plans (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id      INTEGER NOT NULL REFERENCES patients(id),
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      status          TEXT NOT NULL DEFAULT 'active',
      summary         TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_reviewed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_tx_plans_patient ON treatment_plans(patient_id, status);

    CREATE TABLE IF NOT EXISTS treatment_goals (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id          INTEGER NOT NULL REFERENCES treatment_plans(id),
      goal_text        TEXT NOT NULL,
      target_metric    TEXT,
      baseline_value   REAL,
      current_value    REAL,
      status           TEXT NOT NULL DEFAULT 'active',
      interventions_json TEXT DEFAULT '[]',
      progress_notes_json TEXT DEFAULT '[]',
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      met_at           DATETIME,
      revised_at       DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_tx_goals_plan ON treatment_goals(plan_id, status);

    -- Pillar 4: Sub-Agent Delegation — parallel task execution log
    CREATE TABLE IF NOT EXISTS delegated_tasks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      parent_message_id INTEGER,
      goal            TEXT NOT NULL,
      scope           TEXT,
      status          TEXT NOT NULL DEFAULT 'running',
      model_used      TEXT,
      result_json     TEXT,
      tokens_used     INTEGER DEFAULT 0,
      started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at    DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_delegated_therapist ON delegated_tasks(therapist_id, status);

    -- Pillar 5: Practice Intelligence — cross-client clinical pattern memory
    CREATE TABLE IF NOT EXISTS practice_insights (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id     INTEGER NOT NULL REFERENCES therapists(id),
      insight_type     TEXT NOT NULL,
      insight_text     TEXT NOT NULL,
      evidence_json    TEXT DEFAULT '[]',
      confidence_score REAL NOT NULL DEFAULT 0.5,
      patient_ids_json TEXT DEFAULT '[]',
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_validated_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_insights_therapist ON practice_insights(therapist_id, insight_type, is_active);

    -- Pillar 6: Proactive Outreach — autonomous client communication rules
    CREATE TABLE IF NOT EXISTS outreach_rules (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id     INTEGER NOT NULL REFERENCES therapists(id),
      rule_type        TEXT NOT NULL,
      label            TEXT,
      config_json      TEXT NOT NULL DEFAULT '{}',
      enabled          INTEGER NOT NULL DEFAULT 1,
      last_executed_at DATETIME,
      execute_count    INTEGER NOT NULL DEFAULT 0,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_outreach_rules_therapist ON outreach_rules(therapist_id, enabled);

    CREATE TABLE IF NOT EXISTS outreach_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      patient_id      INTEGER NOT NULL REFERENCES patients(id),
      rule_id         INTEGER REFERENCES outreach_rules(id),
      outreach_type   TEXT NOT NULL,
      channel         TEXT NOT NULL DEFAULT 'sms',
      message_preview TEXT,
      status          TEXT NOT NULL DEFAULT 'sent',
      error           TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_outreach_log_therapist ON outreach_log(therapist_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_outreach_log_patient ON outreach_log(patient_id, created_at DESC);

    -- ═══════════════════════════════════════════════════════════════════════
    -- GROUP PRACTICE MULTI-TENANCY
    -- ═══════════════════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS practices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      slug            TEXT UNIQUE NOT NULL,
      owner_id        INTEGER NOT NULL REFERENCES therapists(id),
      logo_url        TEXT,
      address         TEXT,
      phone           TEXT,
      email           TEXT,
      npi_number      TEXT,
      tax_id          TEXT,
      stripe_subscription_id TEXT,
      max_clinicians  INTEGER NOT NULL DEFAULT 3,
      settings_json   TEXT DEFAULT '{}',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS practice_members (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      practice_id     INTEGER NOT NULL REFERENCES practices(id),
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      role            TEXT NOT NULL DEFAULT 'clinician',
      status          TEXT NOT NULL DEFAULT 'active',
      invited_by      INTEGER REFERENCES therapists(id),
      invite_token    TEXT UNIQUE,
      invited_at      DATETIME,
      joined_at       DATETIME,
      removed_at      DATETIME,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(practice_id, therapist_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pm_practice ON practice_members(practice_id, status);
    CREATE INDEX IF NOT EXISTS idx_pm_therapist ON practice_members(therapist_id);

    CREATE TABLE IF NOT EXISTS supervision_links (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      practice_id     INTEGER NOT NULL REFERENCES practices(id),
      supervisor_id   INTEGER NOT NULL REFERENCES therapists(id),
      supervisee_id   INTEGER NOT NULL REFERENCES therapists(id),
      access_level    TEXT NOT NULL DEFAULT 'read_notes',
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(practice_id, supervisor_id, supervisee_id)
    );

    CREATE TABLE IF NOT EXISTS shared_patients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      practice_id     INTEGER NOT NULL REFERENCES practices(id),
      patient_id      INTEGER NOT NULL REFERENCES patients(id),
      shared_with_id  INTEGER NOT NULL REFERENCES therapists(id),
      shared_by_id    INTEGER NOT NULL REFERENCES therapists(id),
      access_level    TEXT NOT NULL DEFAULT 'read',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(patient_id, shared_with_id)
    );

    CREATE TABLE IF NOT EXISTS practice_templates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      practice_id     INTEGER NOT NULL REFERENCES practices(id),
      created_by      INTEGER NOT NULL REFERENCES therapists(id),
      template_type   TEXT NOT NULL,
      name            TEXT NOT NULL,
      content_json    TEXT NOT NULL,
      is_default      INTEGER NOT NULL DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS practice_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      practice_id     INTEGER NOT NULL REFERENCES practices(id),
      author_id       INTEGER NOT NULL REFERENCES therapists(id),
      message_type    TEXT NOT NULL DEFAULT 'announcement',
      title           TEXT,
      content         TEXT NOT NULL,
      pinned          INTEGER NOT NULL DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Pillar 7: Agentic Documentation — enrichment suggestions on session notes
    CREATE TABLE IF NOT EXISTS note_enrichments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      INTEGER NOT NULL REFERENCES sessions(id),
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      enrichment_type TEXT NOT NULL,
      content_json    TEXT NOT NULL,
      accepted        INTEGER,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_enrichments_session ON note_enrichments(session_id);

    -- ═══════════════════════════════════════════════════════════════════════
    -- TIER 1 AGENTIC UPGRADES
    -- ═══════════════════════════════════════════════════════════════════════

    -- Feature 1: Persistent Session Memory with Compression
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id         INTEGER NOT NULL REFERENCES therapists(id),
      summary              TEXT NOT NULL,
      messages_compressed  INTEGER NOT NULL DEFAULT 0,
      token_estimate       INTEGER,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Feature 2: Agent-Created Scheduled Tasks
    CREATE TABLE IF NOT EXISTS agent_scheduled_tasks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      task_type       TEXT NOT NULL DEFAULT 'reminder',
      description     TEXT NOT NULL,
      prompt          TEXT NOT NULL,
      scheduled_for   DATETIME NOT NULL,
      recurring       TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      result          TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at    DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_scheduled ON agent_scheduled_tasks(status, scheduled_for);

    -- Feature 4: Background Tasks with Notifications
    CREATE TABLE IF NOT EXISTS background_tasks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      task_type       TEXT NOT NULL,
      description     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'running',
      progress        INTEGER DEFAULT 0,
      result_json     TEXT,
      error           TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at    DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_bg_tasks ON background_tasks(therapist_id, status);

    -- Feature 5: Event-Driven Triggers
    CREATE TABLE IF NOT EXISTS event_triggers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id    INTEGER NOT NULL REFERENCES therapists(id),
      event_type      TEXT NOT NULL,
      action_type     TEXT NOT NULL,
      config_json     TEXT DEFAULT '{}',
      enabled         INTEGER NOT NULL DEFAULT 1,
      fire_count      INTEGER NOT NULL DEFAULT 0,
      last_fired_at   DATETIME,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_event_triggers ON event_triggers(event_type, enabled);

    -- ═══════════════════════════════════════════════════════════════════════
    -- CLIENT PORTAL — magic-link access for therapy clients
    -- ═══════════════════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS client_portal_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      expires_at DATETIME NOT NULL,
      last_accessed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_portal_tokens ON client_portal_tokens(token);

    CREATE TABLE IF NOT EXISTS client_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      therapist_id INTEGER NOT NULL REFERENCES therapists(id),
      sender TEXT NOT NULL DEFAULT 'client',
      message TEXT NOT NULL,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_client_msgs ON client_messages(patient_id, created_at);
  `);
}

// Idempotent migration: adds therapist_id to existing tables if not already present.
function runMigrations() {
  const stmt = db.prepare('PRAGMA table_info(patients)');
  const columns = [];
  while (stmt.step()) {
    columns.push(stmt.getAsObject());
  }
  stmt.free();

  const alreadyMigrated = columns.some(c => c.name === 'therapist_id');
  if (!alreadyMigrated) {
    try {
      db.run('ALTER TABLE patients      ADD COLUMN therapist_id INTEGER');
      db.run('ALTER TABLE sessions      ADD COLUMN therapist_id INTEGER');
      db.run('ALTER TABLE chat_messages ADD COLUMN therapist_id INTEGER');
      db.run('ALTER TABLE documents     ADD COLUMN therapist_id INTEGER');
    } catch (_) { /* column already exists */ }
  }

  // Subscription columns migration — always check
  const therapistCols = [];
  const tStmt = db.prepare('PRAGMA table_info(therapists)');
  while (tStmt.step()) therapistCols.push(tStmt.getAsObject().name);
  tStmt.free();

  const subCols = [
    ['subscription_status', "TEXT NOT NULL DEFAULT 'trial'"],
    ['subscription_tier',   'TEXT'],
    ['stripe_customer_id',  'TEXT'],
    ['stripe_subscription_id', 'TEXT'],
    ['workspace_uses',      'INTEGER NOT NULL DEFAULT 0'],
    ['trial_limit',         'INTEGER NOT NULL DEFAULT 10'],
    ['is_admin',            'INTEGER NOT NULL DEFAULT 0'],
    ['account_status',      "TEXT NOT NULL DEFAULT 'active'"],
    ['avatar_url',          'TEXT'],
    ['assistant_action_mode', "TEXT NOT NULL DEFAULT 'draft_only'"],
    ['assistant_tone',       'TEXT'],
    ['assistant_orientation','TEXT'],
    ['assistant_verbosity',  'TEXT'],
    ['assistant_memory',     'TEXT'],
    ['assistant_permissions_json', 'TEXT'],
    ['last_login_at',        'DATETIME'],
    ['last_seen_at',         'DATETIME'],
    ['first_name',           'TEXT'],
    ['last_name',            'TEXT'],
    ['preferred_timezone',   "TEXT NOT NULL DEFAULT 'America/Los_Angeles'"],
    // Credential verification
    ['credential_type',      "TEXT NOT NULL DEFAULT 'licensed'"],  // 'trainee' | 'associate' | 'licensed'
    ['credential_number',    'TEXT'],   // license/registration number (associate/licensed)
    ['school_email',         'TEXT'],   // trainee's .edu / school email used for verification
    ['credential_verified',  'INTEGER NOT NULL DEFAULT 0'],
    ['credential_verified_at','DATETIME'],
    // Email-address verification (separate from credential / trainee verification)
    ['email_verified',        'INTEGER NOT NULL DEFAULT 0'],
    ['email_verified_at',     'DATETIME'],
    ['telehealth_url',        'TEXT'],  // therapist's video platform link (Zoom, Doxy, etc.)
    // Group practice membership
    ['practice_id',           'INTEGER'],  // FK to practices.id — cached for fast lookups
    ['practice_role',         'TEXT'],     // cached role from practice_members
  ];
  for (const [col, def] of subCols) {
    if (!therapistCols.includes(col)) {
      try { db.run(`ALTER TABLE therapists ADD COLUMN ${col} ${def}`); } catch {}
    }
  }
  // Grandfather existing therapists past the new email-verification gate.
  // Anyone who has ever logged in (or whose row predates this migration)
  // is treated as already verified so they don't get locked out by the new
  // flow we're rolling out for fresh registrations.
  try {
    db.run(`UPDATE therapists
              SET email_verified = 1, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)
            WHERE email_verified = 0
              AND (last_login_at IS NOT NULL OR created_at < datetime('now','-1 hour'))`);
  } catch {}

  // User feedback — submitted via Miwa chat or future feedback form
  db.run(`CREATE TABLE IF NOT EXISTS user_feedback (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id INTEGER REFERENCES therapists(id),
    message      TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'general',
    source       TEXT NOT NULL DEFAULT 'chat',
    status       TEXT NOT NULL DEFAULT 'new',
    admin_response TEXT,
    resolved_at  DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // AI cost events — one row per AI call, for per-therapist usage + budget enforcement
  db.run(`CREATE TABLE IF NOT EXISTS cost_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id   INTEGER REFERENCES therapists(id),
    kind           TEXT NOT NULL,            -- 'chat', 'brief', 'classify', 'analyze', etc.
    provider       TEXT NOT NULL,            -- e.g. 'azure-openai'
    model          TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    cost_cents     INTEGER NOT NULL DEFAULT 0,   -- cost in cents (rounded up)
    status         TEXT NOT NULL DEFAULT 'ok',   -- 'ok' | 'error' | 'over_budget'
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_cost_events_therapist ON cost_events(therapist_id, created_at)`); } catch {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_cost_events_month ON cost_events(created_at)`); } catch {}

  // Monthly AI budget per therapist (cents). Null = use tier default.
  // Auto-pause flag — set when a therapist blows past their monthly budget.
  const budgetCols = [
    ['ai_budget_monthly_cents', 'INTEGER'],
    ['ai_budget_paused',        'INTEGER DEFAULT 0'],
  ];
  for (const [col, def] of budgetCols) {
    if (!therapistCols.includes(col)) {
      try { db.run(`ALTER TABLE therapists ADD COLUMN ${col} ${def}`); } catch {}
    }
  }

  // Daily briefings — "Your Day" morning summary per therapist
  db.run(`CREATE TABLE IF NOT EXISTS daily_briefings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id  INTEGER NOT NULL REFERENCES therapists(id),
    local_date    TEXT NOT NULL,                -- YYYY-MM-DD in therapist's timezone
    markdown      TEXT NOT NULL,
    stats_json    TEXT,
    opened_at     DATETIME,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(therapist_id, local_date)
  )`);
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_daily_briefings_therapist_date ON daily_briefings(therapist_id, local_date)`); } catch {}
  // Additive columns for morning briefing 2.0 — Azure OpenAI narrative + per-client
  // caseload status. Added idempotently so older DBs migrate forward on boot.
  try { db.run(`ALTER TABLE daily_briefings ADD COLUMN narrative TEXT`); } catch {}
  try { db.run(`ALTER TABLE daily_briefings ADD COLUMN caseload_json TEXT`); } catch {}
  try { db.run(`ALTER TABLE daily_briefings ADD COLUMN emailed_at DATETIME`); } catch {}

  // Contacts: allow a contact to show on the public /network page.
  // 0 = private to the owning therapist (default). 1 = public.
  try { db.run(`ALTER TABLE therapist_contacts ADD COLUMN public INTEGER NOT NULL DEFAULT 0`); } catch {}
  // Index the public column for the /api/public/network listing. Has to
  // come AFTER the ALTER TABLE — on an existing DB, the column doesn't
  // exist until that migration runs, so this index can't live up in the
  // initial CREATE TABLE block.
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_contacts_public ON therapist_contacts(public, name ASC)`); } catch {}

  // Training trajectories — ShareGPT-format log of every agent conversation,
  // for future fine-tuning of a Miwa-specific clinical model.
  // Clinician can opt out; default ON. Stored as JSON blob per turn.
  db.run(`CREATE TABLE IF NOT EXISTS training_trajectories (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id      INTEGER NOT NULL REFERENCES therapists(id),
    session_token     TEXT,                     -- groups turns within a chat session
    model             TEXT,                     -- e.g. 'gpt-main'
    conversation_json TEXT NOT NULL,            -- ShareGPT-style [{from, value}, ...] array
    tool_calls_count  INTEGER DEFAULT 0,
    turn_completed    INTEGER DEFAULT 0,        -- 1 if turn finished successfully
    rating            TEXT,                     -- 'good' | 'bad' | NULL (therapist feedback)
    rating_note       TEXT,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_traj_therapist ON training_trajectories(therapist_id, created_at)`); } catch {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_traj_session ON training_trajectories(session_token)`); } catch {}

  // agent_tasks indices — hot paths are "list my tasks recent-first" and
  // "worker picks up next queued task globally."
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_therapist ON agent_tasks(therapist_id, created_at DESC)`); } catch {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent_tasks(status, created_at)`); } catch {}

  // Opt-out flag on therapists — default enabled
  if (!therapistCols.includes('training_data_opt_out')) {
    try { db.run('ALTER TABLE therapists ADD COLUMN training_data_opt_out INTEGER DEFAULT 0'); } catch {}
  }

  // Onboarding chat status — tracks whether Miwa has introduced itself
  if (!therapistCols.includes('onboarding_completed')) {
    try { db.run('ALTER TABLE therapists ADD COLUMN onboarding_completed INTEGER DEFAULT 0'); } catch {}
  }
  if (!therapistCols.includes('soul_markdown')) {
    try { db.run('ALTER TABLE therapists ADD COLUMN soul_markdown TEXT'); } catch {}
  }

  // Treatment plan revision history — HIPAA/liability record of every change
  // to a treatment plan or its goals. Append-only; never overwritten.
  db.run(`CREATE TABLE IF NOT EXISTS treatment_plan_revisions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id           INTEGER NOT NULL REFERENCES treatment_plans(id),
    therapist_id      INTEGER NOT NULL REFERENCES therapists(id),
    patient_id        INTEGER REFERENCES patients(id),
    revision_num      INTEGER NOT NULL,
    snapshot_json     TEXT NOT NULL,              -- full plan + goals at this point
    change_kind       TEXT NOT NULL,              -- 'plan_created' | 'goal_added' | 'goal_updated' | 'goal_status' | 'plan_archived'
    change_detail     TEXT,
    author_kind       TEXT NOT NULL DEFAULT 'therapist',  -- 'therapist' | 'agent' | 'system'
    author_id         INTEGER,                    -- therapist_id if author_kind = 'therapist'
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_tp_revisions_plan ON treatment_plan_revisions(plan_id, revision_num)`); } catch {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_tp_revisions_patient ON treatment_plan_revisions(patient_id, created_at)`); } catch {}

  // HIPAA PHI access audit log — append-only, tracks every access to patient data
  db.run(`CREATE TABLE IF NOT EXISTS phi_access_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id   INTEGER,
    action         TEXT NOT NULL,
    resource       TEXT NOT NULL,
    patient_id     INTEGER,
    method         TEXT,
    status_code    INTEGER,
    ip             TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_phi_log_therapist ON phi_access_log(therapist_id, created_at)`); } catch {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_phi_log_patient ON phi_access_log(patient_id, created_at)`); } catch {}

  // Credential verifications table — used for school email link verification (trainees)
  db.run(`CREATE TABLE IF NOT EXISTS credential_verifications (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id     INTEGER NOT NULL REFERENCES therapists(id),
    token            TEXT UNIQUE NOT NULL,
    verify_email     TEXT NOT NULL,
    verified_at      DATETIME,
    expires_at       DATETIME NOT NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (adminEmail) {
    try { db.run('UPDATE therapists SET is_admin = 1 WHERE lower(email) = ?', adminEmail); } catch {}
  }

  // Sessions extra columns migration
  const sessionCols = [];
  const sStmt = db.prepare('PRAGMA table_info(sessions)');
  while (sStmt.step()) sessionCols.push(sStmt.getAsObject().name);
  sStmt.free();
  if (!sessionCols.includes('note_format')) {
    try { db.run("ALTER TABLE sessions ADD COLUMN note_format TEXT NOT NULL DEFAULT 'SOAP'"); } catch {}
  }
  if (!sessionCols.includes('notes_json')) {
    try { db.run('ALTER TABLE sessions ADD COLUMN notes_json TEXT'); } catch {}
  }
  if (!sessionCols.includes('treatment_plan')) {
    try { db.run('ALTER TABLE sessions ADD COLUMN treatment_plan TEXT'); } catch {}
  }
  if (!sessionCols.includes('duration_minutes')) {
    try { db.run('ALTER TABLE sessions ADD COLUMN duration_minutes INTEGER'); } catch {}
  }
  if (!sessionCols.includes('cpt_code')) {
    try { db.run('ALTER TABLE sessions ADD COLUMN cpt_code TEXT'); } catch {}
  }
  if (!sessionCols.includes('signed_at')) {
    try { db.run('ALTER TABLE sessions ADD COLUMN signed_at DATETIME'); } catch {}
  }
  if (!sessionCols.includes('full_note')) {
    try { db.run('ALTER TABLE sessions ADD COLUMN full_note TEXT'); } catch {}
  }

  const patientCols = [];
  const pStmt = db.prepare('PRAGMA table_info(patients)');
  while (pStmt.step()) patientCols.push(pStmt.getAsObject().name);
  pStmt.free();
  const patientAdditions = [
    ['case_type', 'TEXT'],
    ['age_range', 'TEXT'],
    ['referral_source', 'TEXT'],
    ['living_situation', 'TEXT'],
    ['client_overview', 'TEXT'],
    ['client_overview_signature', 'TEXT'],
    ['mental_health_history', 'TEXT'],
    ['substance_use', 'TEXT'],
    ['risk_screening', 'TEXT'],
    ['family_social_history', 'TEXT'],
    ['mental_status_observations', 'TEXT'],
    ['treatment_goals', 'TEXT'],
    ['medical_history', 'TEXT'],
    ['medications', 'TEXT'],
    ['trauma_history', 'TEXT'],
    ['strengths_protective_factors', 'TEXT'],
    ['functional_impairments', 'TEXT'],
    ['first_name', 'TEXT'],
    ['last_name', 'TEXT'],
    // Couple / family / souls support
    ['client_type', "TEXT NOT NULL DEFAULT 'individual'"],
    ['members', 'TEXT'], // JSON array e.g. ["Soul-1","Soul-2"]
    // Miwa agent — display name + SMS/Email delivery
    ['display_name', 'TEXT'],  // clinician-chosen name/nickname shown in UI and used by Miwa; never sent to AI as-is
    ['phone', 'TEXT'],         // client mobile number for SMS assessment delivery (E.164 preferred)
    ['email', 'TEXT'],         // client email address for email assessment delivery
    ['preferred_contact_method', "TEXT DEFAULT 'sms'"],  // 'sms' | 'email' | 'ask' — how to send assessments/links
    ['session_modality', "TEXT DEFAULT 'in-person'"],  // 'in-person' | 'telehealth' | 'hybrid'
    ['session_duration', 'INTEGER DEFAULT 50'],          // preferred session length in minutes
    // SMS consent (Twilio toll-free verification requirement — block sends until therapist confirms)
    ['sms_consent', 'INTEGER DEFAULT 0'],   // 1 once therapist attests they obtained client SMS consent
    ['sms_consent_at', 'DATETIME'],          // timestamp of that attestation
    ['date_of_birth', 'TEXT'],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['therapy_ended_at', 'TEXT'],
    ['retention_until', 'TEXT'],
    ['retention_basis', 'TEXT'],
    ['archived_at', 'DATETIME'],
    ['legal_hold', 'INTEGER DEFAULT 0'],
    ['legal_hold_reason', 'TEXT'],
  ];
  for (const [col, def] of patientAdditions) {
    if (!patientCols.includes(col)) {
      try { db.run(`ALTER TABLE patients ADD COLUMN ${col} ${def}`); } catch {}
    }
  }
  // Backfill existing rows — SQLite ALTER TABLE ADD COLUMN does NOT apply DEFAULT to existing rows
  try { db.run("UPDATE patients SET client_type = 'individual' WHERE client_type IS NULL OR client_type = ''"); } catch {}
  try { db.run("UPDATE patients SET status = 'active' WHERE status IS NULL OR status = ''"); } catch {}

  // ── practice_hours — trainee/associate hour tracking (CSUN MFT first) ─────
  // Manual log entries only. Direct-service hours are computed on the fly
  // from completed appointments — we deliberately don't materialize them
  // here so edits to an appointment automatically reflect in the totals.
  db.run(`CREATE TABLE IF NOT EXISTS practice_hours (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id INTEGER NOT NULL REFERENCES therapists(id),
    bucket_id    TEXT    NOT NULL,                -- e.g. 'supervision_individual'
    date         TEXT    NOT NULL,                -- YYYY-MM-DD (therapist local)
    hours        REAL    NOT NULL,                -- decimal hours, 0.25 step
    supervisor   TEXT,                            -- supervisor name (BBS audit-trail)
    site         TEXT,                            -- field site label
    notes        TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_practice_hours_therapist_date ON practice_hours(therapist_id, date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_practice_hours_bucket         ON practice_hours(therapist_id, bucket_id)');

  // ── scheduled_sends — queued SMS assessment deliveries ────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS scheduled_sends (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id     INTEGER NOT NULL REFERENCES therapists(id),
    patient_id       INTEGER NOT NULL REFERENCES patients(id),
    assessment_type  TEXT    NOT NULL,
    token            TEXT    NOT NULL,
    phone            TEXT    NOT NULL,
    send_at          DATETIME NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'pending',
    sent_at          DATETIME,
    error            TEXT,
    custom_message   TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const docCols = [];
  const dStmt = db.prepare('PRAGMA table_info(documents)');
  while (dStmt.step()) docCols.push(dStmt.getAsObject().name);
  dStmt.free();
  if (!docCols.includes('document_kind')) {
    try {
      db.run("ALTER TABLE documents ADD COLUMN document_kind TEXT NOT NULL DEFAULT 'record'");
      db.run("UPDATE documents SET document_kind = 'record' WHERE document_kind IS NULL OR document_kind = ''");
    } catch {}
  }

  // Assessment member_label migration (couple/family souls support)
  const assessmentCols = [];
  const assStmt = db.prepare('PRAGMA table_info(assessments)');
  while (assStmt.step()) assessmentCols.push(assStmt.getAsObject().name);
  assStmt.free();
  if (!assessmentCols.includes('member_label')) {
    try { db.run('ALTER TABLE assessments ADD COLUMN member_label TEXT'); } catch {}
  }

  const appointmentCols = [];
  const aStmt = db.prepare('PRAGMA table_info(appointments)');
  while (aStmt.step()) appointmentCols.push(aStmt.getAsObject().name);
  aStmt.free();
  const appointmentAdditions = [
    ['calendar_provider', "TEXT NOT NULL DEFAULT 'internal'"],
    ['google_calendar_id', 'TEXT'],
    ['google_event_id', 'TEXT'],
    ['sync_status', "TEXT NOT NULL DEFAULT 'internal'"],
    ['sync_error', 'TEXT'],
    ['last_synced_at', 'DATETIME'],
    ['attendance_status', "TEXT DEFAULT 'pending'"],  // pending | checked_in | late | no_show | cancelled
    ['checked_in_at', 'DATETIME'],
    ['minutes_late', 'INTEGER DEFAULT 0'],
    ['attendance_notes', 'TEXT'],
    ['mbc_auto_sent', 'INTEGER DEFAULT 0'],  // 1 = PHQ-9 + GAD-7 auto-queued for this appointment
    ['client_display_name', 'TEXT'],  // Denormalized snapshot of patient.display_name at appointment creation
    // Google Meet (HIPAA-covered via Workspace BAA on admin@miwa.care)
    ['meet_url',       'TEXT'],   // https://meet.google.com/xxx-yyyy-zzz, generated when appointment_type='telehealth'
    ['meet_event_id',  'TEXT'],   // Calendar event ID (lets us delete the calendar entry)
    ['meet_space_name','TEXT'],   // Meet API v2 space name like "spaces/abc123" (for endActiveConference on regen/cancel)
    // Practicum hour tracking — manual override of the auto-mapped bucket
    // (e.g. when a session that looks like an "Individual Adult" was actually
    // with a 17-year-old, or a couple session got typed as 'individual').
    // NULL = use the default mapping. See services/practiceHours.js.
    ['practicum_bucket_override', 'TEXT'],
  ];
  for (const [col, def] of appointmentAdditions) {
    if (!appointmentCols.includes(col)) {
      try { db.run(`ALTER TABLE appointments ADD COLUMN ${col} ${def}`); } catch {}
    }
  }

  // Create index on proactive_alerts for fast querying
  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_proactive_alerts_therapist_created ON proactive_alerts(therapist_id, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_proactive_alerts_dismissed ON proactive_alerts(dismissed_at)');
  } catch {}

  // Seed: Detective Marie Sadanaga (LAPD DV/SA unit) for admin@miwa.care.
  // Idempotent. Uses raw sql.js statements directly because at this point in
  // init, the wrapper helpers (db.get / db.all) haven't been attached yet.
  try {
    const selAdmin = db.prepare(
      `SELECT id FROM therapists WHERE LOWER(email) = 'admin@miwa.care' LIMIT 1`
    );
    let adminId = null;
    if (selAdmin.step()) {
      adminId = selAdmin.getAsObject().id;
    }
    selAdmin.free();

    if (adminId) {
      const selExisting = db.prepare(
        `SELECT id FROM therapist_contacts
         WHERE therapist_id = ? AND LOWER(email) = '37206@lapd.online'`
      );
      selExisting.bind([adminId]);
      let existingId = null;
      if (selExisting.step()) {
        existingId = selExisting.getAsObject().id;
      }
      selExisting.free();

      if (!existingId) {
        db.run(
          `INSERT INTO therapist_contacts
            (therapist_id, name, title, agency, specialty, email, category, notes, pinned, public)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
          [
            adminId,
            'Detective Marie Sadanaga',
            'Detective, DV/SA Unit',
            'LAPD',
            'Intimate partner violence and sexual assault cases',
            '37206@lapd.online',
            'law_enforcement',
            'Point of contact for LAPD DV referrals and warm handoffs when a client screens High-Danger on the LAP-MD lethality screen.',
          ]
        );
        console.log('[db] Seeded Detective Marie Sadanaga into admin@miwa.care contacts (pinned + public)');
      } else {
        // Ensure she is flagged public even if she was seeded before the public column existed.
        try {
          db.run(`UPDATE therapist_contacts SET public = 1 WHERE id = ?`, [existingId]);
        } catch {}
      }
    }
  } catch (err) {
    console.warn('[db] Contact seed skipped:', err.message);
  }

  // Research briefs: add save + opened tracking columns for auto-decay
  const briefCols = [];
  try {
    const bStmt = db.prepare('PRAGMA table_info(research_briefs)');
    while (bStmt.step()) briefCols.push(bStmt.getAsObject().name);
    bStmt.free();
  } catch {}
  if (briefCols.length && !briefCols.includes('saved')) {
    try { db.run('ALTER TABLE research_briefs ADD COLUMN saved INTEGER DEFAULT 0'); } catch {}
  }
  if (briefCols.length && !briefCols.includes('opened_at')) {
    try { db.run('ALTER TABLE research_briefs ADD COLUMN opened_at DATETIME'); } catch {}
  }
  if (briefCols.length && !briefCols.includes('local_date')) {
    try { db.run('ALTER TABLE research_briefs ADD COLUMN local_date TEXT'); } catch {}
  }
  if (briefCols.length && !briefCols.includes('timezone')) {
    try { db.run('ALTER TABLE research_briefs ADD COLUMN timezone TEXT'); } catch {}
  }

  // Auto-backfill: keep missing names boring and deterministic. Never invent
  // fake human names for clinical records.
  try {
    const stmt = db.prepare("SELECT id, client_id FROM patients WHERE display_name IS NULL OR display_name = ''");
    const unnamed = [];
    while (stmt.step()) unnamed.push(stmt.getAsObject());
    stmt.free();
    for (const p of unnamed) {
      db.run('UPDATE patients SET display_name = ? WHERE id = ?', [p.client_id || `Client ${p.id}`, p.id]);
    }
    if (unnamed.length > 0) console.log(`[db] Backfilled ${unnamed.length} missing client display name(s) from chart codes`);
  } catch {}

  // Backfill: populate appointments.client_display_name for existing rows.
  // This snapshots the linked patient's display_name onto the appointment so
  // the calendar always shows a name even if the patient is later deleted.
  try {
    const backfilled = db.run(
      `UPDATE appointments
         SET client_display_name = (
           SELECT p.display_name FROM patients p
           WHERE p.id = appointments.patient_id
           LIMIT 1
         )
       WHERE (client_display_name IS NULL OR client_display_name = '')
         AND patient_id IS NOT NULL`
    );
    // sql.js wrapper doesn't return row count, so just log success
    console.log('[db] Backfilled appointment display names');
  } catch (err) {
    console.error('[db] Appointment name backfill error:', err.message);
  }

  persist();
}

// Persist DB to disk after every write.
//
// Atomic write: we serialize the in-memory DB, write it to a sibling temp
// file, fsync it, then rename over the live file. POSIX rename is atomic,
// so even if the process is SIGTERM'd mid-write during redeploy, the
// live file is either the old contents or the new contents — never half
// of one and half of the other.
//
// Shrink-protection: refuse to write a snapshot that is dramatically
// smaller than what's currently on disk. Today's data loss happened when
// an empty in-memory DB silently overwrote a populated file; once that
// write committed, the old data was unrecoverable. The threshold is
// configurable via DB_SHRINK_THRESHOLD (0.5 = refuse if shrinking by more
// than 50%). Set ALLOW_DB_SHRINK=true to override for legitimate reasons
// (mass-delete of test data, reset-database admin action).
const SHRINK_THRESHOLD = Number(process.env.DB_SHRINK_THRESHOLD || '0.5');

function persist(opts = {}) {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);

    // Sanity check 1: never persist a database that doesn't look like a real
    // SQLite file (e.g., zero bytes). This is belt-and-suspenders against
    // a bad in-memory state somehow getting saved.
    if (!buffer.length || !buffer.slice(0, 16).toString('utf8').startsWith('SQLite format 3')) {
      console.error(`[db] persist refused: in-memory DB serialized to ${buffer.length} bytes, not a valid SQLite file. Skipping write.`);
      return;
    }

    // Sanity check 2: refuse catastrophic shrinkage unless explicitly allowed.
    // If the in-memory snapshot is much smaller than the file on disk, that's
    // almost always a bug or an unexpected mass-delete — bail out and let the
    // operator investigate before the existing data gets clobbered.
    //
    // Override paths:
    //   - opts.allowShrink: true     ← explicit per-call opt-in (reset-database,
    //                                   future bulk-delete tools)
    //   - ALLOW_DB_SHRINK=true env   ← server-wide override for emergencies
    const shrinkAllowed = opts.allowShrink === true
      || String(process.env.ALLOW_DB_SHRINK || '').toLowerCase() === 'true';
    if (!shrinkAllowed) {
      try {
        const existing = fs.statSync(DB_PATH);
        if (existing.size > 0 && buffer.length < existing.size * (1 - SHRINK_THRESHOLD)) {
          console.error(
            `[db] persist REFUSED — shrink protection: new=${buffer.length}B vs existing=${existing.size}B ` +
            `(${Math.round((1 - buffer.length / existing.size) * 100)}% smaller). ` +
            `Pass { allowShrink: true } to persist() or set ALLOW_DB_SHRINK=true if intentional.`
          );
          return;
        }
      } catch {
        // File doesn't exist yet — first write, allow it.
      }
    }

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const tmpPath = `${DB_PATH}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, buffer, 0, buffer.length);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, DB_PATH);
  } catch (err) {
    if (err?.code === 'ENOENT' && process.env.NODE_ENV === 'test') {
      return;
    }
    console.error('DB persist error:', err.message);
  }
}

function getDb() {
  if (!db) throw new Error('Database not initialised yet');
  return {
    run(sql, ...params) {
      db.run(sql, flattenParams(params));
      persist();
    },
    all(sql, ...params) {
      const stmt = db.prepare(sql);
      stmt.bind(flattenParams(params));
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    },
    get(sql, ...params) {
      const stmt = db.prepare(sql);
      stmt.bind(flattenParams(params));
      const row = stmt.step() ? stmt.getAsObject() : undefined;
      stmt.free();
      return row;
    },
    insert(sql, ...params) {
      db.run(sql, flattenParams(params));
      const idRow = db.exec('SELECT last_insert_rowid() as id');
      const id = idRow[0]?.values[0]?.[0];
      persist();
      return { lastInsertRowid: id };
    },
    exec(sql) {
      db.run(sql);
      persist();
    },
    prepare(sql) {
      const self = this;
      return {
        run(...params) { self.run(sql, ...params); },
        all(...params) { return self.all(sql, ...params); },
        get(...params) { return self.get(sql, ...params); },
      };
    },
  };
}

function flattenParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function resetDbForTests() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetDbForTests is only available when NODE_ENV=test');
  }
  try {
    if (db && typeof db.close === 'function') db.close();
  } catch {}
  db = null;
  SqlJs = null;
}

module.exports = { initDb, getDb, persist, resetDbForTests };
