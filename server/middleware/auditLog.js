/**
 * HIPAA PHI Access Audit Logger
 *
 * Logs every authenticated request that touches patient data so you can
 * answer "who accessed what, when" for any regulator or breach investigation.
 *
 * Logged to `phi_access_log` table — append-only by design.
 * Non-blocking: errors are swallowed so audit logging never breaks user flow.
 */

const { getAsyncDb } = require('../db/asyncDb');

// Routes that touch PHI — log these
const PHI_PATTERNS = [
  /^\/api\/patients/,
  /^\/api\/assessments/,
  /^\/api\/ai\/(chat|analyze|treatment|dictate|convert|client-summary)/,
  /^\/api\/agent/,
  /^\/api\/research\/briefs/,
];

// Read-only methods (GET, HEAD, OPTIONS) vs. writes (POST, PUT, PATCH, DELETE)
function actionType(method) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'read';
  if (method === 'DELETE') return 'delete';
  return 'write';
}

function logAuditFailure(err, context = {}) {
  console.error('phi audit log insert failed', {
    provider: 'database',
    errorCode: err?.code || null,
    errorType: err?.name || 'Error',
    route: context.route || null,
    method: context.method || null,
    statusCode: context.statusCode || null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Express middleware — insert after requireAuth so req.therapist is populated.
 * Usage: app.use('/api/patients', requireAuth, phiAuditLog, router)
 *
 * Can also be used as a standalone function for manual logging:
 *   logPhiAccess({ therapistId, action, resource, patientId, detail })
 */
function phiAuditLog(req, res, next) {
  // Only log PHI-touching routes
  const isPhi = PHI_PATTERNS.some(p => p.test(req.originalUrl || req.url));
  if (!isPhi) return next();

  const therapistId = req.therapist?.id;
  if (!therapistId) return next();

  // Extract patient ID from URL if present
  const patientMatch = (req.originalUrl || req.url).match(/\/patients\/(\d+)/);
  const patientId = patientMatch ? parseInt(patientMatch[1], 10) : null;

  const action = actionType(req.method);
  const resource = (req.originalUrl || req.url).split('?')[0]; // Strip query params

  // Log after response is sent (so we capture the status code)
  res.on('finish', () => {
    try {
      const db = getAsyncDb();
      Promise.resolve(db.run(
        `INSERT INTO phi_access_log (therapist_id, action, resource, patient_id, method, status_code, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        therapistId,
        action,
        resource.slice(0, 500),
        patientId,
        req.method,
        res.statusCode,
        (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 45),
      )).catch((err) => logAuditFailure(err, {
        route: resource,
        method: req.method,
        statusCode: res.statusCode,
      }));
    } catch (err) {
      logAuditFailure(err, {
        route: resource,
        method: req.method,
        statusCode: res.statusCode,
      });
      // Never let audit logging break the app
    }
  });

  next();
}

/**
 * Manual PHI access log — for background tasks that don't go through Express routes.
 */
async function logPhiAccess({ therapistId, action, resource, patientId = null, detail = null }) {
  try {
    const db = getAsyncDb();
    await db.run(
      `INSERT INTO phi_access_log (therapist_id, action, resource, patient_id, method, status_code, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      therapistId, action, String(resource).slice(0, 500), patientId, detail || 'SYSTEM', 200, 'internal'
    );
  } catch (err) {
    logAuditFailure(err, {
      route: String(resource).slice(0, 500),
      method: detail || 'SYSTEM',
      statusCode: 200,
    });
  }
}

module.exports = { phiAuditLog, logPhiAccess };
