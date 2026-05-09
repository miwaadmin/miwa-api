const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Ensure the local generated_reports directory exists so PDF report writes
// don't fail at runtime. Matches REPORTS_DIR in agent/lib/reports-pipeline.js.
const REPORTS_DIR = path.join(__dirname, '..', 'generated_reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

router.use(require('./agent/portal'));
router.use(require('./agent/appointments'));
router.use(require('./agent/reports'));
router.use(require('./agent/trainee'));
router.use(require('./agent/chat'));
router.use(require('./agent/voice'));
router.use(require('./agent/preferences'));
router.use(require('./agent/treatment-plans'));

module.exports = router;

// ── Expose internals for task-runner.js and agentPrivacy.test.js ─────────────
// These were the public surface of the old monolithic agent.js. Keeping them
// re-exported here means external consumers can keep importing from
// 'server/routes/agent' without churn.
const { AGENT_TOOLS, AI_AGENT_TOOLS } = require('./agent/tools/definitions');
const { executeAgentTool } = require('./agent/tools/execute');
const {
  isInternalModelQuestion,
  internalModelDisclosureReply,
} = require('./agent/lib/helpers');

module.exports.AGENT_TOOLS = AGENT_TOOLS;
module.exports.AI_AGENT_TOOLS = AI_AGENT_TOOLS;
module.exports.executeAgentTool = executeAgentTool;
module.exports.isInternalModelQuestion = isInternalModelQuestion;
module.exports.internalModelDisclosureReply = internalModelDisclosureReply;
