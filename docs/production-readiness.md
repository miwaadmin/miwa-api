# Miwa Production Readiness Notes

This is the near-term bar before inviting real clinicians to store PHI in Miwa.

## Infrastructure

- Use Azure App Service for the Node/React monolith.
- Use Azure Database for PostgreSQL Flexible Server as the production database.
- Azure OpenAI remains an approved PHI-capable model path.
- OpenAI API may be used for PHI text/reasoning only through the approved
  BAA-backed Zero Data Retention project. Set `AI_TEXT_PROVIDER=auto`,
  `OPENAI_PHI_API_KEY`, `OPENAI_PHI_ZDR_ENABLED=true`, and optionally
  `OPENAI_PHI_MODEL` (defaults to `gpt-5.5`). Miwa routes complex clinical
  reasoning, risk, reports, session prep, and clinical document synthesis to
  that flagship lane, while cheaper utility work can use
  `OPENAI_PHI_FAST_MODEL`, `OPENAI_PHI_TOOL_MODEL`, and
  `OPENAI_PHI_STRUCTURED_MODEL` (all default to `gpt-5.4-mini`). Do not use
  live web search, files, vector stores, assistants, threads, batches, evals,
  or fine-tuning for PHI.
- Miwa Live Voice additionally requires `OPENAI_REALTIME_PHI_ENABLED=true`.
  Recommended defaults are `OPENAI_REALTIME_MODEL=gpt-realtime-2`,
  `OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-transcribe`,
  `OPENAI_REALTIME_TRANSLATION_MODEL=gpt-realtime-2`, and
  `OPENAI_REALTIME_VOICE=marin`. Browser clients receive only short-lived
  Realtime client secrets minted by the authenticated backend.
- Store secrets in Azure App Service configuration now; move to Azure Key Vault
  before scale.
- Keep `miwa.care` and `www.miwa.care` serving the app. Use `api.miwa.care`
  only for API/testing diagnostics, not as the clinician-facing website.

## Data

- Do not commit `.env`, database files, uploads, generated reports, logs, or
  backup files.
- Treat uploaded documents and generated PDFs as PHI. Document uploads now use
  Azure Blob Storage when `AZURE_STORAGE_CONNECTION_STRING` or
  `AZURE_BLOB_CONNECTION_STRING` is configured; otherwise they fall back to
  local disk for development. Generated reports still need the same migration.
- Turn on PostgreSQL automatic backups and point-in-time restore.
- Keep diagnostic endpoints disabled in production unless actively recovering.

## Security

- Do not return raw server exception messages to users.
- Do not log raw prompts, raw model responses, clinical notes, transcripts, or
  uploaded document text.
- Keep audit logging on PHI routes.
- Require strong `JWT_SECRET`, HTTPS-only cookies, and production CORS origins.
- Review all third-party services for BAA coverage before PHI is routed there.

## Launch Gate

Admins can call `/api/admin/readiness` for a non-secret launch checklist. The
endpoint intentionally reports only pass/warn/fail metadata and never returns
connection strings, API keys, or secret values.

Miwa is good enough for a small private beta when:

- Login, registration, password reset, and email verification work on Azure.
- Patient CRUD, session notes, assessments, public links, and document upload
  work against Azure PostgreSQL.
- AI features use an approved BAA-backed provider path and fail safely. If
  direct OpenAI is enabled, `/api/ai/status` and `/api/admin/readiness` must
  show the OpenAI PHI/ZDR lane as configured and ZDR-confirmed.
- Uploads/reports are stored outside the App Service filesystem.
- Logs contain operational metadata only, not PHI.
- Backups and restore have been tested end-to-end.
