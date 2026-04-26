/**
 * Group Practice Management Routes
 *
 * Full CRUD for practices, member management, supervision links,
 * patient sharing, dashboard analytics, and practice-wide messaging.
 *
 * All routes require authentication. Practice-specific routes additionally
 * require active practice membership via requirePracticeMember.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const requireAuth = require('../middleware/auth');
const { requirePracticeMember, requirePracticeRole } = require('../middleware/practice');
const { getAsyncDb } = require('../db/asyncDb');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a practice name.
 * Lowercases, replaces spaces/underscores with hyphens, strips special chars,
 * and appends a random 4-char suffix if a collision exists.
 */
async function generateSlug(name, db) {
  let base = name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')        // spaces & underscores -> hyphens
    .replace(/[^a-z0-9-]/g, '')     // strip everything else
    .replace(/-+/g, '-')            // collapse multiple hyphens
    .replace(/^-|-$/g, '');          // trim leading/trailing hyphens

  if (!base) base = 'practice';

  let slug = base;
  const existing = await db.get('SELECT id FROM practices WHERE slug = ?', slug);
  if (existing) {
    const suffix = crypto.randomBytes(2).toString('hex'); // 4 hex chars
    slug = `${base}-${suffix}`;
  }

  return slug;
}

/**
 * Build the invite URL from an invite token.
 * Uses APP_BASE_URL env var or falls back to a relative path.
 */
function buildInviteUrl(token) {
  const base = process.env.APP_BASE_URL || '';
  return `${base}/practice/join/${token}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRACTICE CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/practice/create
 * Create a new group practice. The authenticated user becomes the owner.
 * Body: { name, address?, phone?, email?, npi_number? }
 */
router.post('/create', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapistId = req.therapist.id;
    const { name, address, phone, email, npi_number } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Practice name is required.' });
    }

    // Check if the therapist is already in a practice
    const existingMembership = await db.get(
      `SELECT id FROM practice_members
       WHERE therapist_id = ? AND status = 'active'`,
      therapistId
    );
    if (existingMembership) {
      return res.status(409).json({
        error: 'You are already a member of a practice. Leave your current practice first.'
      });
    }

    const slug = await generateSlug(name, db);

    // Create the practice
    const result = await db.insert(
      `INSERT INTO practices (name, slug, owner_id, address, phone, email, npi_number)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      name.trim(),
      slug,
      therapistId,
      address || null,
      phone || null,
      email || null,
      npi_number || null
    );

    const practiceId = result.lastInsertRowid;

    // Create the owner's membership record
    await db.insert(
      `INSERT INTO practice_members (practice_id, therapist_id, role, status, joined_at)
       VALUES (?, ?, 'owner', 'active', CURRENT_TIMESTAMP)`,
      practiceId,
      therapistId
    );

    // Cache the practice association on the therapist row for fast lookups
    await db.run(
      'UPDATE therapists SET practice_id = ?, practice_role = ? WHERE id = ?',
      practiceId, 'owner', therapistId
    );

    const practice = await db.get('SELECT * FROM practices WHERE id = ?', practiceId);
    res.status(201).json(practice);
  } catch (err) {
    console.error('POST /api/practice/create error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/practice
 * Get the current user's practice details, member count, and basic stats.
 */
router.get('/', requireAuth, requirePracticeMember, async (req, res) => {
  try {
    const db = getAsyncDb();
    const practice = req.practice;

    const memberCount = (await db.get(
      `SELECT COUNT(*) as count FROM practice_members
       WHERE practice_id = ? AND status = 'active'`,
      practice.id
    )).count;

    const pendingInvites = (await db.get(
      `SELECT COUNT(*) as count FROM practice_members
       WHERE practice_id = ? AND status = 'invited'`,
      practice.id
    )).count;

    // Total patients across all practice members
    const totalPatients = (await db.get(
      `SELECT COUNT(*) as count FROM patients p
       INNER JOIN practice_members pm ON pm.therapist_id = p.therapist_id
       WHERE pm.practice_id = ? AND pm.status = 'active'`,
      practice.id
    )).count;

    res.json({
      ...practice,
      settings: (() => {
        try { return practice.settings_json ? JSON.parse(practice.settings_json) : {}; }
        catch { return {}; }
      })(),
      member_count: memberCount,
      pending_invites: pendingInvites,
      total_patients: totalPatients,
      your_role: req.practiceRole,
    });
  } catch (err) {
    console.error('GET /api/practice error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/practice
 * Update practice info. Owner or admin only.
 * Body: { name?, address?, phone?, email?, npi_number?, settings_json? }
 */
router.put('/', requireAuth, requirePracticeMember, requirePracticeRole('owner', 'admin'), async (req, res) => {
  try {
    const db = getAsyncDb();
    const practice = req.practice;
    const { name, address, phone, email, npi_number, settings_json } = req.body;

    // If name changed, regenerate slug
    let slug = practice.slug;
    if (name && name.trim() !== practice.name) {
      slug = await generateSlug(name, db);
    }

    await db.run(
      `UPDATE practices SET
         name = ?, slug = ?, address = ?, phone = ?, email = ?,
         npi_number = ?, settings_json = ?
       WHERE id = ?`,
      name?.trim() || practice.name,
      slug,
      address !== undefined ? address : practice.address,
      phone !== undefined ? phone : practice.phone,
      email !== undefined ? email : practice.email,
      npi_number !== undefined ? npi_number : practice.npi_number,
      settings_json !== undefined
        ? (typeof settings_json === 'string' ? settings_json : JSON.stringify(settings_json))
        : practice.settings_json,
      practice.id
    );

    const updated = await db.get('SELECT * FROM practices WHERE id = ?', practice.id);
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/practice error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// MEMBER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/practice/members
 * List all practice members with profile info.
 * Owner/admin see full details. Others see names and roles only.
 */
router.get('/members', requireAuth, requirePracticeMember, async (req, res) => {
  try {
    const db = getAsyncDb();
    const practiceId = req.practice.id;
    const isPrivileged = ['owner', 'admin'].includes(req.practiceRole);

    let members;
    if (isPrivileged) {
      // Full view for owner/admin
      members = await db.all(
        `SELECT pm.id as member_id, pm.role, pm.status, pm.joined_at, pm.invited_at,
                t.id as therapist_id, t.first_name, t.last_name, t.full_name, t.email,
                t.user_role, t.credential_type, t.avatar_url, t.last_seen_at
         FROM practice_members pm
         LEFT JOIN therapists t ON t.id = pm.therapist_id
         WHERE pm.practice_id = ? AND pm.status IN ('active', 'invited')
         ORDER BY
           CASE pm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'supervisor' THEN 3 ELSE 4 END,
           t.last_name ASC`,
        practiceId
      );
    } else {
      // Limited view for clinicians/supervisors
      members = await db.all(
        `SELECT pm.id as member_id, pm.role, pm.status,
                t.id as therapist_id, t.first_name, t.last_name, t.full_name, t.avatar_url
         FROM practice_members pm
         LEFT JOIN therapists t ON t.id = pm.therapist_id
         WHERE pm.practice_id = ? AND pm.status = 'active'
         ORDER BY
           CASE pm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'supervisor' THEN 3 ELSE 4 END,
           t.last_name ASC`,
        practiceId
      );
    }

    res.json(members);
  } catch (err) {
    console.error('GET /api/practice/members error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/practice/invite
 * Invite a clinician to the practice. Owner/admin only.
 * Body: { email, role: 'clinician' | 'supervisor' | 'admin' }
 */
router.post('/invite', requireAuth, requirePracticeMember, requirePracticeRole('owner', 'admin'), async (req, res) => {
  try {
    const db = getAsyncDb();
    const practiceId = req.practice.id;
    const { email, role } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const validRoles = ['clinician', 'supervisor', 'admin'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({
        error: `Role must be one of: ${validRoles.join(', ')}.`
      });
    }

    // Only owners can invite admins
    if (role === 'admin' && req.practiceRole !== 'owner') {
      return res.status(403).json({ error: 'Only the practice owner can invite admins.' });
    }

    // Check max clinicians limit
    const activeCount = (await db.get(
      `SELECT COUNT(*) as count FROM practice_members
       WHERE practice_id = ? AND status IN ('active', 'invited')`,
      practiceId
    )).count;

    if (activeCount >= req.practice.max_clinicians) {
      return res.status(409).json({
        error: `Practice has reached its member limit of ${req.practice.max_clinicians}. Upgrade your plan to add more.`
      });
    }

    // Check if this email is already a member or has a pending invite
    const existingTherapist = await db.get(
      'SELECT id FROM therapists WHERE LOWER(email) = ?',
      email.trim().toLowerCase()
    );

    if (existingTherapist) {
      const existingMember = await db.get(
        `SELECT id, status FROM practice_members
         WHERE practice_id = ? AND therapist_id = ?`,
        practiceId, existingTherapist.id
      );

      if (existingMember && existingMember.status === 'active') {
        return res.status(409).json({ error: 'This person is already an active member of your practice.' });
      }
      if (existingMember && existingMember.status === 'invited') {
        return res.status(409).json({ error: 'An invitation is already pending for this email.' });
      }
    }

    // Generate a cryptographically secure invite token
    const inviteToken = crypto.randomBytes(32).toString('hex');

    // Create the membership record with status 'invited'
    // If the therapist exists, link them; otherwise use a placeholder therapist_id of 0
    // and resolve on join
    const therapistIdForInvite = existingTherapist ? existingTherapist.id : 0;

    await db.insert(
      `INSERT INTO practice_members
         (practice_id, therapist_id, role, status, invited_by, invite_token, invited_at)
       VALUES (?, ?, ?, 'invited', ?, ?, CURRENT_TIMESTAMP)`,
      practiceId,
      therapistIdForInvite,
      role,
      req.therapist.id,
      inviteToken
    );

    const inviteUrl = buildInviteUrl(inviteToken);

    res.status(201).json({
      message: `Invitation sent to ${email.trim()}.`,
      invite_url: inviteUrl,
      invite_token: inviteToken,
      email: email.trim(),
      role,
    });
  } catch (err) {
    console.error('POST /api/practice/invite error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/practice/join/:token
 * Accept a practice invitation. Validates token, activates membership,
 * and links the therapist to the practice.
 */
router.post('/join/:token', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const { token } = req.params;
    const therapistId = req.therapist.id;

    if (!token) {
      return res.status(400).json({ error: 'Invite token is required.' });
    }

    // Find the invite
    const invite = await db.get(
      `SELECT pm.*, p.name as practice_name
       FROM practice_members pm
       INNER JOIN practices p ON p.id = pm.practice_id
       WHERE pm.invite_token = ? AND pm.status = 'invited'`,
      token
    );

    if (!invite) {
      return res.status(404).json({
        error: 'Invalid or expired invitation. Please ask your practice administrator for a new invite.'
      });
    }

    // Check if therapist is already in another practice
    const existingMembership = await db.get(
      `SELECT id FROM practice_members
       WHERE therapist_id = ? AND status = 'active'`,
      therapistId
    );
    if (existingMembership) {
      return res.status(409).json({
        error: 'You are already a member of a practice. Leave your current practice before joining another.'
      });
    }

    // If the invite was created with therapist_id = 0 (email-only invite),
    // update it to the current therapist. If it was pre-linked, verify match.
    if (invite.therapist_id !== 0 && invite.therapist_id !== therapistId) {
      return res.status(403).json({
        error: 'This invitation was issued to a different account.'
      });
    }

    // Activate the membership
    await db.run(
      `UPDATE practice_members SET
         therapist_id = ?, status = 'active', invite_token = NULL, joined_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      therapistId, invite.id
    );

    // Cache the practice association on the therapist
    await db.run(
      'UPDATE therapists SET practice_id = ?, practice_role = ? WHERE id = ?',
      invite.practice_id, invite.role, therapistId
    );

    res.json({
      message: `Welcome to ${invite.practice_name}!`,
      practice_id: invite.practice_id,
      role: invite.role,
    });
  } catch (err) {
    console.error('POST /api/practice/join error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/practice/members/:memberId/role
 * Change a member's role within the practice.
 * Owner can change anyone. Admin can change clinicians/supervisors but not the owner.
 */
router.put('/members/:memberId/role', requireAuth, requirePracticeMember, requirePracticeRole('owner', 'admin'), async (req, res) => {
  try {
    const db = getAsyncDb();
    const { memberId } = req.params;
    const { role } = req.body;

    const validRoles = ['clinician', 'supervisor', 'admin'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({
        error: `Role must be one of: ${validRoles.join(', ')}.`
      });
    }

    // Fetch the target member
    const member = await db.get(
      `SELECT * FROM practice_members WHERE id = ? AND practice_id = ?`,
      memberId, req.practice.id
    );

    if (!member) {
      return res.status(404).json({ error: 'Member not found in this practice.' });
    }

    // Cannot change the owner's role
    if (member.role === 'owner') {
      return res.status(403).json({ error: 'The practice owner\'s role cannot be changed.' });
    }

    // Admins cannot promote to admin (only owner can)
    if (role === 'admin' && req.practiceRole !== 'owner') {
      return res.status(403).json({ error: 'Only the practice owner can assign the admin role.' });
    }

    // Admins cannot change other admins
    if (member.role === 'admin' && req.practiceRole !== 'owner') {
      return res.status(403).json({ error: 'Only the practice owner can change an admin\'s role.' });
    }

    await db.run(
      'UPDATE practice_members SET role = ? WHERE id = ?',
      role, memberId
    );

    // Update the cached role on the therapist row
    await db.run(
      'UPDATE therapists SET practice_role = ? WHERE id = ?',
      role, member.therapist_id
    );

    res.json({
      message: 'Role updated successfully.',
      member_id: parseInt(memberId),
      new_role: role,
    });
  } catch (err) {
    console.error('PUT /api/practice/members/:memberId/role error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/practice/members/:memberId
 * Remove a member from the practice. Does NOT delete their account --
 * just unlinks them. Sets member status to 'removed' and clears the
 * therapist's cached practice_id. Owner/admin only. Cannot remove the owner.
 */
router.delete('/members/:memberId', requireAuth, requirePracticeMember, requirePracticeRole('owner', 'admin'), async (req, res) => {
  try {
    const db = getAsyncDb();
    const { memberId } = req.params;

    const member = await db.get(
      'SELECT * FROM practice_members WHERE id = ? AND practice_id = ?',
      memberId, req.practice.id
    );

    if (!member) {
      return res.status(404).json({ error: 'Member not found in this practice.' });
    }

    // Cannot remove the owner
    if (member.role === 'owner') {
      return res.status(403).json({
        error: 'The practice owner cannot be removed. Transfer ownership first.'
      });
    }

    // Admins cannot remove other admins
    if (member.role === 'admin' && req.practiceRole !== 'owner') {
      return res.status(403).json({ error: 'Only the practice owner can remove an admin.' });
    }

    // Mark as removed (soft delete)
    await db.run(
      `UPDATE practice_members SET status = 'removed', removed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      memberId
    );

    // Clear the cached practice association on the therapist
    await db.run(
      'UPDATE therapists SET practice_id = NULL, practice_role = NULL WHERE id = ?',
      member.therapist_id
    );

    // Deactivate any supervision links involving this member
    await db.run(
      `UPDATE supervision_links SET status = 'inactive'
       WHERE practice_id = ? AND (supervisor_id = ? OR supervisee_id = ?)`,
      req.practice.id, member.therapist_id, member.therapist_id
    );

    // SECURITY: Remove all shared patient access for removed member
    await db.run(
      `DELETE FROM shared_patients WHERE shared_with_id = ? AND practice_id = ?`,
      member.therapist_id, req.practice.id
    );

    res.json({
      message: 'Member removed from practice.',
      member_id: parseInt(memberId),
    });
  } catch (err) {
    console.error('DELETE /api/practice/members/:memberId error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// SUPERVISION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/practice/supervision
 * Create a supervision link between two practice members.
 * Body: { supervisee_id, access_level? }
 * Owner/admin only.
 */
router.post('/supervision', requireAuth, requirePracticeMember, requirePracticeRole('owner', 'admin'), async (req, res) => {
  try {
    const db = getAsyncDb();
    const practiceId = req.practice.id;
    const { supervisor_id, supervisee_id, access_level } = req.body;

    // supervisor_id is optional -- defaults to current user for supervisors
    // creating their own links. Required for owner/admin assigning others.
    const resolvedSupervisorId = supervisor_id || req.therapist.id;

    if (!supervisee_id) {
      return res.status(400).json({ error: 'supervisee_id is required.' });
    }

    if (resolvedSupervisorId === supervisee_id) {
      return res.status(400).json({ error: 'A therapist cannot supervise themselves.' });
    }

    // Verify both are active members of this practice
    const supervisorMember = await db.get(
      `SELECT id FROM practice_members
       WHERE practice_id = ? AND therapist_id = ? AND status = 'active'`,
      practiceId, resolvedSupervisorId
    );
    const superviseeMember = await db.get(
      `SELECT id FROM practice_members
       WHERE practice_id = ? AND therapist_id = ? AND status = 'active'`,
      practiceId, supervisee_id
    );

    if (!supervisorMember) {
      return res.status(404).json({ error: 'Supervisor is not an active member of this practice.' });
    }
    if (!superviseeMember) {
      return res.status(404).json({ error: 'Supervisee is not an active member of this practice.' });
    }

    // Check for existing active link
    const existing = await db.get(
      `SELECT id FROM supervision_links
       WHERE practice_id = ? AND supervisor_id = ? AND supervisee_id = ? AND status = 'active'`,
      practiceId, resolvedSupervisorId, supervisee_id
    );
    if (existing) {
      return res.status(409).json({ error: 'This supervision link already exists.' });
    }

    const result = await db.insert(
      `INSERT INTO supervision_links (practice_id, supervisor_id, supervisee_id, access_level)
       VALUES (?, ?, ?, ?)`,
      practiceId,
      resolvedSupervisorId,
      supervisee_id,
      access_level || 'read_notes'
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      supervisor_id: resolvedSupervisorId,
      supervisee_id: parseInt(supervisee_id),
      access_level: access_level || 'read_notes',
    });
  } catch (err) {
    console.error('POST /api/practice/supervision error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/practice/supervision
 * List supervision links.
 * Owner/admin see all links in the practice.
 * Supervisors see only their own supervisees.
 */
router.get('/supervision', requireAuth, requirePracticeMember, async (req, res) => {
  try {
    const db = getAsyncDb();
    const practiceId = req.practice.id;
    const isPrivileged = ['owner', 'admin'].includes(req.practiceRole);

    let links;
    if (isPrivileged) {
      links = await db.all(
        `SELECT sl.*,
                sup.first_name as supervisor_first_name, sup.last_name as supervisor_last_name,
                sub.first_name as supervisee_first_name, sub.last_name as supervisee_last_name
         FROM supervision_links sl
         LEFT JOIN therapists sup ON sup.id = sl.supervisor_id
         LEFT JOIN therapists sub ON sub.id = sl.supervisee_id
         WHERE sl.practice_id = ? AND sl.status = 'active'
         ORDER BY sup.last_name, sub.last_name`,
        practiceId
      );
    } else {
      // Supervisors see only their supervisees
      links = await db.all(
        `SELECT sl.*,
                sub.first_name as supervisee_first_name, sub.last_name as supervisee_last_name
         FROM supervision_links sl
         LEFT JOIN therapists sub ON sub.id = sl.supervisee_id
         WHERE sl.practice_id = ? AND sl.supervisor_id = ? AND sl.status = 'active'
         ORDER BY sub.last_name`,
        practiceId, req.therapist.id
      );
    }

    res.json(links);
  } catch (err) {
    console.error('GET /api/practice/supervision error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/practice/supervision/:id
 * Remove a supervision link. Owner/admin only.
 */
router.delete('/supervision/:id', requireAuth, requirePracticeMember, requirePracticeRole('owner', 'admin'), async (req, res) => {
  try {
    const db = getAsyncDb();
    const { id } = req.params;

    const link = await db.get(
      `SELECT * FROM supervision_links WHERE id = ? AND practice_id = ?`,
      id, req.practice.id
    );

    if (!link) {
      return res.status(404).json({ error: 'Supervision link not found.' });
    }

    await db.run(
      `UPDATE supervision_links SET status = 'inactive' WHERE id = ?`,
      id
    );

    res.json({ message: 'Supervision link removed.', id: parseInt(id) });
  } catch (err) {
    console.error('DELETE /api/practice/supervision/:id error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// PATIENT SHARING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/practice/share-patient
 * Share a patient with another clinician in the same practice.
 * Body: { patient_id, shared_with_id, access_level: 'read' | 'write' }
 * Only the patient's owning therapist (or owner/admin) can share.
 */
router.post('/share-patient', requireAuth, requirePracticeMember, async (req, res) => {
  try {
    const db = getAsyncDb();
    const practiceId = req.practice.id;
    const { patient_id, shared_with_id, access_level } = req.body;

    if (!patient_id || !shared_with_id) {
      return res.status(400).json({ error: 'patient_id and shared_with_id are required.' });
    }

    const validLevels = ['read', 'write'];
    if (access_level && !validLevels.includes(access_level)) {
      return res.status(400).json({ error: `access_level must be one of: ${validLevels.join(', ')}.` });
    }

    // Verify the patient exists and get their owner
    const patient = await db.get('SELECT id, therapist_id FROM patients WHERE id = ?', patient_id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    // Authorization: only the owning therapist or practice owner/admin can share
    const isOwner = patient.therapist_id === req.therapist.id;
    const isPrivileged = ['owner', 'admin'].includes(req.practiceRole);
    if (!isOwner && !isPrivileged) {
      return res.status(403).json({
        error: 'Only the patient\'s therapist or a practice owner/admin can share patients.'
      });
    }

    // Verify the target is an active member of this practice
    const targetMember = await db.get(
      `SELECT id FROM practice_members
       WHERE practice_id = ? AND therapist_id = ? AND status = 'active'`,
      practiceId, shared_with_id
    );
    if (!targetMember) {
      return res.status(404).json({ error: 'Target clinician is not an active member of this practice.' });
    }

    // Cannot share a patient with their owning therapist
    if (parseInt(shared_with_id) === patient.therapist_id) {
      return res.status(400).json({ error: 'Cannot share a patient with their own therapist.' });
    }

    // Check for existing share
    const existingShare = await db.get(
      'SELECT id, shared_by_id FROM shared_patients WHERE patient_id = ? AND shared_with_id = ?',
      patient_id, shared_with_id
    );
    if (existingShare) {
      // SECURITY: Only the original sharer or owner/admin can update access level
      const canUpdate = existingShare.shared_by_id === req.therapist.id
        || ['owner', 'admin'].includes(req.practiceRole);
      if (!canUpdate) {
        return res.status(403).json({ error: 'You cannot modify this sharing arrangement.' });
      }
      await db.run(
        'UPDATE shared_patients SET access_level = ? WHERE id = ?',
        access_level || 'read', existingShare.id
      );
      return res.json({ message: 'Patient sharing access level updated.', id: existingShare.id });
    }

    const result = await db.insert(
      `INSERT INTO shared_patients (practice_id, patient_id, shared_with_id, shared_by_id, access_level)
       VALUES (?, ?, ?, ?, ?)`,
      practiceId,
      patient_id,
      shared_with_id,
      req.therapist.id,
      access_level || 'read'
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      patient_id: parseInt(patient_id),
      shared_with_id: parseInt(shared_with_id),
      access_level: access_level || 'read',
    });
  } catch (err) {
    console.error('POST /api/practice/share-patient error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/practice/shared-patients
 * List patients shared with the current user.
 */
router.get('/shared-patients', requireAuth, requirePracticeMember, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapistId = req.therapist.id;

    const shared = await db.all(
      `SELECT sp.id as share_id, sp.access_level, sp.created_at as shared_at,
              p.id as patient_id, p.client_id, p.display_name, p.presenting_concerns,
              p.diagnoses, p.case_type, p.client_type,
              sharer.first_name as shared_by_first_name, sharer.last_name as shared_by_last_name
       FROM shared_patients sp
       INNER JOIN patients p ON p.id = sp.patient_id
       LEFT JOIN therapists sharer ON sharer.id = sp.shared_by_id
       WHERE sp.shared_with_id = ?
       ORDER BY sp.created_at DESC`,
      therapistId
    );

    res.json(shared);
  } catch (err) {
    console.error('GET /api/practice/shared-patients error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// PRACTICE DASHBOARD (owner/admin only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/practice/dashboard
 * Aggregate stats for the practice. No PHI -- just counts and utilization.
 * Owner/admin only.
 */
router.get('/dashboard', requireAuth, requirePracticeMember, requirePracticeRole('owner', 'admin'), async (req, res) => {
  try {
    const db = getAsyncDb();
    const practiceId = req.practice.id;

    // Total active members
    const totalMembers = (await db.get(
      `SELECT COUNT(*) as count FROM practice_members
       WHERE practice_id = ? AND status = 'active'`,
      practiceId
    )).count;

    // Total patients across all members
    const totalPatients = (await db.get(
      `SELECT COUNT(*) as count FROM patients p
       INNER JOIN practice_members pm ON pm.therapist_id = p.therapist_id
       WHERE pm.practice_id = ? AND pm.status = 'active'`,
      practiceId
    )).count;

    // Total sessions this week (across practice)
    const sessionsThisWeek = (await db.get(
      `SELECT COUNT(*) as count FROM sessions s
       INNER JOIN practice_members pm ON pm.therapist_id = s.therapist_id
       WHERE pm.practice_id = ? AND pm.status = 'active'
         AND (s.session_date >= date('now', '-7 days') OR s.created_at >= datetime('now', '-7 days'))`,
      practiceId
    )).count;

    // Total assessments this month
    const assessmentsThisMonth = (await db.get(
      `SELECT COUNT(*) as count FROM assessments a
       INNER JOIN practice_members pm ON pm.therapist_id = a.therapist_id
       WHERE pm.practice_id = ? AND pm.status = 'active'
         AND a.created_at >= datetime('now', '-30 days')`,
      practiceId
    )).count;

    // Per-clinician utilization: session counts (no PHI)
    const utilization = await db.all(
      `SELECT t.id as therapist_id,
              t.first_name, t.last_name,
              pm.role,
              COUNT(DISTINCT p.id) as patient_count,
              (SELECT COUNT(*) FROM sessions s
               WHERE s.therapist_id = t.id
                 AND (s.session_date >= date('now', '-7 days') OR s.created_at >= datetime('now', '-7 days'))
              ) as sessions_this_week,
              (SELECT COUNT(*) FROM sessions s
               WHERE s.therapist_id = t.id
                 AND (s.session_date >= date('now', '-30 days') OR s.created_at >= datetime('now', '-30 days'))
              ) as sessions_this_month
       FROM practice_members pm
       INNER JOIN therapists t ON t.id = pm.therapist_id
       LEFT JOIN patients p ON p.therapist_id = t.id
       WHERE pm.practice_id = ? AND pm.status = 'active'
       GROUP BY t.id
       ORDER BY sessions_this_week DESC`,
      practiceId
    );

    // Pending invites count
    const pendingInvites = (await db.get(
      `SELECT COUNT(*) as count FROM practice_members
       WHERE practice_id = ? AND status = 'invited'`,
      practiceId
    )).count;

    res.json({
      total_members: totalMembers,
      total_patients: totalPatients,
      sessions_this_week: sessionsThisWeek,
      assessments_this_month: assessmentsThisMonth,
      pending_invites: pendingInvites,
      clinician_utilization: utilization,
    });
  } catch (err) {
    console.error('GET /api/practice/dashboard error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// PRACTICE MESSAGES / ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/practice/messages
 * List practice announcements/messages. All members can read.
 * Returns most recent first, with pinned messages at top.
 */
router.get('/messages', requireAuth, requirePracticeMember, async (req, res) => {
  try {
    const db = getAsyncDb();
    const practiceId = req.practice.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const messages = await db.all(
      `SELECT m.*, t.first_name as author_first_name, t.last_name as author_last_name,
              t.avatar_url as author_avatar_url
       FROM practice_messages m
       LEFT JOIN therapists t ON t.id = m.author_id
       WHERE m.practice_id = ?
       ORDER BY m.pinned DESC, m.created_at DESC
       LIMIT ? OFFSET ?`,
      practiceId, limit, offset
    );

    res.json(messages);
  } catch (err) {
    console.error('GET /api/practice/messages error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/practice/messages
 * Create a practice announcement. Owner/admin only.
 * Body: { title, content, message_type?, pinned? }
 */
router.post('/messages', requireAuth, requirePracticeMember, requirePracticeRole('owner', 'admin'), async (req, res) => {
  try {
    const db = getAsyncDb();
    const practiceId = req.practice.id;
    const { title, content, message_type, pinned } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    const result = await db.insert(
      `INSERT INTO practice_messages (practice_id, author_id, message_type, title, content, pinned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      practiceId,
      req.therapist.id,
      message_type || 'announcement',
      title || null,
      content.trim(),
      pinned ? 1 : 0
    );

    const message = await db.get('SELECT * FROM practice_messages WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(message);
  } catch (err) {
    console.error('POST /api/practice/messages error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


module.exports = router;
