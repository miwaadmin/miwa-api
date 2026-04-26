# Miwa Production Readiness Notes

This is the near-term bar before inviting real clinicians to store PHI in Miwa.

## Infrastructure

- Use Azure App Service for the Node/React monolith.
- Use Azure Database for PostgreSQL Flexible Server as the production database.
- Keep Azure OpenAI as the only PHI-capable model path unless another provider
  has a signed BAA and an explicit code path review.
- Store secrets in Azure App Service configuration now; move to Azure Key Vault
  before scale.
- Keep `miwa.care` and `www.miwa.care` serving the app. Use `api.miwa.care`
  only for API/testing diagnostics, not as the clinician-facing website.

## Data

- Do not commit `.env`, database files, uploads, generated reports, logs, or
  backup files.
- Treat uploaded documents and generated PDFs as PHI. Move them to Azure Blob
  Storage with private containers before real launch.
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

Miwa is good enough for a small private beta when:

- Login, registration, password reset, and email verification work on Azure.
- Patient CRUD, session notes, assessments, public links, and document upload
  work against Azure PostgreSQL.
- AI features use Azure OpenAI only and fail safely.
- Uploads/reports are stored outside the App Service filesystem.
- Logs contain operational metadata only, not PHI.
- Backups and restore have been tested end-to-end.
