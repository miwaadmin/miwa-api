# Twilio setup for Miwa closed-beta SMS

Miwa can send closed-beta SMS category reminders through Twilio. Twilio toll-free verification is approved for
+1 855 806 4294, but the Twilio BAA is pending. Do not treat SMS as HIPAA-covered until the BAA is signed.

## Environment variables

SMS is disabled by default. To send in production closed beta, set:

- `SMS_CLOSED_BETA_ENABLED=true`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY_SID`
- `TWILIO_API_KEY_SECRET`
- `TWILIO_PHONE_NUMBER`
- `APP_BASE_URL`

Optional:

- `TWILIO_AUTH_TOKEN` - only needed if you are not using API key auth
- `TWILIO_MESSAGING_SERVICE_SID` - use this if Twilio should route from a messaging service instead of a single sender number

## Required gates

SMS cannot send unless all of these are true:

- `SMS_CLOSED_BETA_ENABLED=true`
- Twilio credentials and sender are configured
- The patient has a phone number
- The patient has `sms_consent=1`

## Allowed message templates

- `Miwa: You have an assessment to complete. [secure link] Reply STOP to opt out.`
- `Miwa: You have a check-in to complete. [secure link] Reply STOP to opt out.`
- `Miwa: You have a secure portal message or update. [secure link] Reply STOP to opt out.`
- `Miwa: You have an appointment update. [secure link if needed] Reply STOP to opt out.`

SMS must not include client names, clinician names, assessment names, diagnoses, symptoms, scores, crisis details,
clinical notes, treatment details, or therapist custom free text.
