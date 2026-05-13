const {
  findPatientByCode,
  findPatientByDisplayName,
} = require('./handlers/deps');
const handlers = require('./handlers');

async function executeAgentTool({ name, args, db, therapistId, nameMap, send, rawMessage }) {
  // Strip brackets from client codes: [DEMO-ABC123] -> DEMO-ABC123
  async function resolvePatient(rawId) {
    const clean = (rawId || '').replace(/[\[\]]/g, '').trim();
    if (!clean) return null;
    return await findPatientByCode(db, therapistId, clean)
      || await findPatientByDisplayName(db, therapistId, clean);
  }

  const handler = handlers[name];
  if (!handler) return { error: `Unknown tool: ${name}` };

  return await handler({
    args,
    db,
    therapistId,
    nameMap,
    send,
    rawMessage,
    resolvePatient,
  });
}

module.exports = { executeAgentTool };
