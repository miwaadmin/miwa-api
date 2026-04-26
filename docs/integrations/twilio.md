# Twilio setup for Miwa

Miwa can send SMS assessment links through Twilio.

## Environment variables

Set these in the server environment:

- TWILIO_ACCOUNT_SID
- TWILIO_API_KEY_SID
- TWILIO_API_KEY_SECRET
- TWILIO_PHONE_NUMBER
- APP_BASE_URL

Optional:

- TWILIO_AUTH_TOKEN — only needed if you are not using API key auth
- TWILIO_MESSAGING_SERVICE_SID — use this if you want Twilio to route from a messaging service instead of a single sender number

## Recommended auth mode

Use API key auth:

- TWILIO_ACCOUNT_SID
- TWILIO_API_KEY_SID
- TWILIO_API_KEY_SECRET

Miwa will fall back to TWILIO_AUTH_TOKEN if API key values are not present.

## Notes

- TWILIO_PHONE_NUMBER should be in E.164 format, e.g. +15551234567.
- Keep messages PHI-light. Miwa sends secure assessment links rather than clinical details.
- If the account is still on Twilio trial, sending may be restricted to verified destination numbers.
- For future international expansion, TWILIO_MESSAGING_SERVICE_SID is a good path to support multiple senders and channel routing.
