/**
 * PHI-safe logger
 *
 * Wraps the Node.js console methods so that any string argument is scrubbed
 * through the same PHI scrubber used on AI inputs before it is written to
 * stdout / stderr.  This means Railway logs, exception reports, and any
 * future log-aggregation sidecar will never receive raw clinical text even
 * if a developer accidentally logs req.body or a session note.
 *
 * Usage:
 *   const log = require('./lib/logger');
 *   log.info('transcript received', transcript);  // transcript is scrubbed
 *
 * Or install globally (done in server.js) to also sanitise any
 * third-party code that calls console.log directly.
 */

'use strict';

const { scrubText } = require('./scrubber');

// ── Scrub any value that is (or contains) a string ──────────────────────────

function sanitize(value) {
  if (typeof value === 'string') return scrubText(value);
  if (value instanceof Error) {
    // Scrub message but keep stack structure
    const clean = new Error(scrubText(value.message));
    clean.stack = value.stack ? scrubText(value.stack) : clean.stack;
    clean.code  = value.code;
    return clean;
  }
  if (value && typeof value === 'object') {
    // Shallow-scrub plain objects (e.g. logged req.body fragments)
    try {
      const clone = {};
      for (const [k, v] of Object.entries(value)) {
        clone[k] = typeof v === 'string' ? scrubText(v) : v;
      }
      return clone;
    } catch { return value; }
  }
  return value;
}

function makeLogger(origFn) {
  return (...args) => origFn(...args.map(sanitize));
}

// ── Named logger (preferred — explicit and tree-shakeable) ───────────────────

const log = {
  info:  makeLogger(console.log.bind(console)),
  warn:  makeLogger(console.warn.bind(console)),
  error: makeLogger(console.error.bind(console)),
  debug: makeLogger(console.log.bind(console)),
};

// ── Global patch (called once from server.js) ──────────────────────────
// Patches the global console so third-party code is also covered.

let _patched = false;
function patchGlobalConsole() {
  if (_patched) return;
  _patched = true;
  console.log   = makeLogger(console.log.bind(console));
  console.info  = makeLogger(console.info.bind(console));
  console.warn  = makeLogger(console.warn.bind(console));
  console.error = makeLogger(console.error.bind(console));
  console.debug = makeLogger(console.debug.bind(console));
}

module.exports = { log, patchGlobalConsole };
