const fs = require('fs');
const path = require('path');

function stripLineComments(sql) {
  return String(sql || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s--.*$/, ''))
    .join('\n');
}

function splitTopLevelComma(input) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (quote) {
      current += ch;
      if (ch === quote) {
        if (next === quote) {
          current += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (ch === '\'' || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;

    if (ch === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function transformColumnDefinition(definition, { forAlter = false } = {}) {
  let out = String(definition || '').trim();
  out = out.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/i, 'SERIAL PRIMARY KEY');
  out = out.replace(/\bDATETIME\b/gi, 'TIMESTAMP');
  out = out.replace(/\bBOOLEAN\b/gi, 'INTEGER');

  if (forAlter) {
    out = out.replace(/\s+PRIMARY\s+KEY\b/gi, '');
    out = out.replace(/\s+UNIQUE\b/gi, '');
    if (!/\bDEFAULT\b/i.test(out)) {
      out = out.replace(/\s+NOT\s+NULL\b/gi, '');
    }
  }

  return out;
}

function isColumnDefinition(definition) {
  return !/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(String(definition || '').trim());
}

function columnName(definition) {
  const match = String(definition || '').trim().match(/^"([^"]+)"|^([A-Za-z_][A-Za-z0-9_]*)/);
  return match?.[1] || match?.[2] || null;
}

function parseCreateTables(source) {
  const clean = stripLineComments(source);
  const tables = [];
  const regex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi;
  let match;

  while ((match = regex.exec(clean)) !== null) {
    const [, table, body] = match;
    // Strip trailing template-literal residue. When a CREATE TABLE statement
    // is wrapped in a JS template literal that closes immediately after the
    // SQL, the lazy regex above can capture past the SQL's own `)` and
    // include the closing backtick + outer `)` of the JS expression. Those
    // characters never legitimately appear in column definitions, so we
    // strip any trailing `)`s, backticks, or the corresponding whitespace.
    const trimmedBody = body.replace(/[\s`)]+$/g, '');
    const definitions = splitTopLevelComma(trimmedBody);
    tables.push({ table, definitions });
  }

  return tables;
}

function parseCreateIndexes(source) {
  const clean = stripLineComments(source);
  const indexes = [];
  const regex = /CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi;
  let match;

  while ((match = regex.exec(clean)) !== null) {
    const [, unique = '', indexName, table, columns] = match;
    indexes.push(`CREATE ${unique || ''}INDEX IF NOT EXISTS ${indexName} ON ${table} (${columns.trim()})`);
  }

  return indexes;
}

function buildCreateTableSql(tableSpec) {
  const definitions = tableSpec.definitions.map((definition) => transformColumnDefinition(definition));
  return `CREATE TABLE IF NOT EXISTS ${tableSpec.table} (\n  ${definitions.join(',\n  ')}\n)`;
}

async function tableExists(db, table) {
  const row = await db.get(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?`,
    table,
  );
  return !!row;
}

async function getExistingColumns(db, table) {
  const rows = await db.all(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?`,
    table,
  );
  return new Set(rows.map((row) => row.column_name));
}

async function applyTable(db, tableSpec) {
  try {
    await db.run(buildCreateTableSql(tableSpec));
  } catch (err) {
    console.warn(`[postgres-schema] skipped table ${tableSpec.table}: ${err.message}`);
  }

  if (!(await tableExists(db, tableSpec.table))) return;
  const existing = await getExistingColumns(db, tableSpec.table);

  for (const definition of tableSpec.definitions) {
    if (!isColumnDefinition(definition)) continue;
    const name = columnName(definition);
    if (!name || existing.has(name) || /^id$/i.test(name)) continue;

    const columnDefinition = transformColumnDefinition(definition, { forAlter: true });
    try {
      await db.run(`ALTER TABLE ${tableSpec.table} ADD COLUMN IF NOT EXISTS ${columnDefinition}`);
    } catch (err) {
      console.warn(`[postgres-schema] skipped ${tableSpec.table}.${name}: ${err.message}`);
    }
  }
}

async function applyIndexes(db, indexSql) {
  for (const sql of indexSql) {
    try {
      await db.run(sql);
    } catch (err) {
      console.warn(`[postgres-schema] skipped index: ${err.message}`);
    }
  }
}

async function applyPostgresSchema(db) {
  const dbJsPath = path.join(__dirname, '..', 'db.js');
  const source = fs.readFileSync(dbJsPath, 'utf8');
  const tables = parseCreateTables(source);
  const indexes = parseCreateIndexes(source);

  for (const tableSpec of tables) {
    await applyTable(db, tableSpec);
  }

  await applyIndexes(db, indexes);

  const backfills = [
    "UPDATE patients SET client_type = 'individual' WHERE client_type IS NULL OR client_type = ''",
    "UPDATE patients SET status = 'active' WHERE status IS NULL OR status = ''",
    "UPDATE documents SET document_kind = 'record' WHERE document_kind IS NULL OR document_kind = ''",
    "UPDATE therapists SET preferred_timezone = 'America/Los_Angeles' WHERE preferred_timezone IS NULL OR preferred_timezone = ''",
  ];
  for (const sql of backfills) {
    try {
      await db.run(sql);
    } catch (err) {
      console.warn(`[postgres-schema] skipped backfill: ${err.message}`);
    }
  }
}

module.exports = {
  applyPostgresSchema,
  buildCreateTableSql,
  parseCreateIndexes,
  parseCreateTables,
  splitTopLevelComma,
  transformColumnDefinition,
};
