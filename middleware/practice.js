/**
 * Practice-level middleware for group practice multi-tenancy.
 *
 * Provides role-based access control (RBAC) for practice operations and
 * patient-level access checks that respect ownership, sharing, and
 * supervision relationships.
 *
 * Tables referenced:
 *   practices, practice_members, therapists, patients,
 *   shared_patients, supervision_links
 */

const { getDb } = require('../db');

// ── Role hierarchy (higher index = more privilege) ──────────────────────────
const ROLE_HIERARCHY = ['clinician', 'supervisor', 'admin', 'owner'];

// ─────────────────────────────────────────────────────────────────────────────
// 1. requirePracticeMember
//    Ensures the authenticated therapist belongs to an active practice.
//    Attaches req.practice (full row) and req.practiceRole (string).
// ─────────────────────────────────────────────────────────────────────────────
function requirePracticeMember(req, res, next) {
  try {
    const db = getDb();
    const therapistId = req.therapist?.id;
    if (!therapistId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    // Look up the therapist's active practice membership
    const member = db.get(
      `SELECT pm.practice_id, pm.role, pm.status
       FROM practice_members pm
       WHERE pm.therapist_id = ? AND pm.status = 'active'
       LIMIT 1`,
      therapistId
    );

    if (!member) {
      return res.status(401).json({
        error: 'You are not a member of any practice. Create or join a practice first.'
      });
    }

    // Fetch the practice itself
    const practice = db.get(
      'SELECT * FROM practices WHERE id = ?',
      member.practice_id
    );

    if (!practice) {
      return res.status(401).json({
        error: 'The practice associated with your account no longer exists.'
      });
    }

    // Attach to request for downstream handlers
    req.practice = practice;
    req.practiceRole = member.role;

    next();
  } catch (err) {
    console.error('requirePracticeMember error:', err.message);
    return res.status(500).json({ error: 'Failed to verify practice membership.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. requirePracticeRole(...roles)
//    Factory that returns middleware enforcing the therapist holds one of the
//    specified roles within their practice.
//    Usage: requirePracticeRole('owner', 'admin')
// ─────────────────────────────────────────────────────────────────────────────
function requirePracticeRole(...roles) {
  // Accept either spread args or a single array
  const allowed = roles.flat();

  return function _requirePracticeRole(req, res, next) {
    if (!req.practiceRole) {
      return res.status(403).json({
        error: 'Practice membership not verified. Ensure requirePracticeMember runs first.'
      });
    }

    if (!allowed.includes(req.practiceRole)) {
      return res.status(403).json({
        error: `This action requires one of the following roles: ${allowed.join(', ')}. Your role: ${req.practiceRole}.`
      });
    }

    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. canAccessPatient
//    Determines whether the therapist can access the patient identified by
//    req.params.id or req.params.patientId.
//
//    Access is granted when any of these conditions hold:
//      (a) The therapist owns the patient          -> accessLevel 'own'
//      (b) The patient is shared with them          -> accessLevel 'shared'
//      (c) They supervise the patient's therapist   -> accessLevel 'supervised'
//
//    Sets req.patientAccessLevel on success.
// ─────────────────────────────────────────────────────────────────────────────
function canAccessPatient(req, res, next) {
  try {
    const db = getDb();
    const therapistId = req.therapist?.id;
    const patientId = req.params.patientId || req.params.id;

    if (!therapistId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!patientId) {
      return res.status(400).json({ error: 'Patient ID is required.' });
    }

    // Fetch the patient to check ownership
    const patient = db.get(
      'SELECT id, therapist_id FROM patients WHERE id = ?',
      patientId
    );

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    // (a) Direct ownership
    if (patient.therapist_id === therapistId) {
      req.patientAccessLevel = 'own';
      return next();
    }

    // (b) Shared via shared_patients table
    const shared = db.get(
      `SELECT id, access_level FROM shared_patients
       WHERE patient_id = ? AND shared_with_id = ?`,
      patientId, therapistId
    );

    if (shared) {
      req.patientAccessLevel = 'shared';
      req.sharedAccessLevel = shared.access_level; // 'read' or 'write'
      return next();
    }

    // (c) Supervision — current therapist supervises the patient's therapist
    const supervision = db.get(
      `SELECT id, access_level FROM supervision_links
       WHERE supervisor_id = ? AND supervisee_id = ? AND status = 'active'`,
      therapistId, patient.therapist_id
    );

    if (supervision) {
      req.patientAccessLevel = 'supervised';
      req.supervisionAccessLevel = supervision.access_level;
      return next();
    }

    // No access path found
    return res.status(403).json({
      error: 'You do not have access to this patient.'
    });
  } catch (err) {
    console.error('canAccessPatient error:', err.message);
    return res.status(500).json({ error: 'Failed to verify patient access.' });
  }
}

module.exports = {
  requirePracticeMember,
  requirePracticeRole,
  canAccessPatient,
};
