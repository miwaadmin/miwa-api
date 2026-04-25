# Miwa API

Azure App Service backend for Miwa Care.

## Azure startup

Azure App Service starts the app with:

```bash
npm start
```

The start script runs:

```bash
node server.js
```

The server listens on `process.env.PORT`.

## Environment

Copy `.env.example` to `.env` for local development. In Azure, configure these values as App Service application settings instead of committing `.env`.

Required minimum:

- `JWT_SECRET`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_KEY`
- `AZURE_OPENAI_DEPLOYMENT`

## Structure

- `server.js` - Express app entrypoint
- `routes/` - HTTP route modules
- `controllers/` - reserved for extracted route controllers
- `services/` - business services and vendor integrations
- `middleware/` - Express middleware
- `lib/` - shared backend helpers
- `tests/` - Node test suite
