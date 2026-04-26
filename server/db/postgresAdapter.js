function flattenParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function translateSqlitePlaceholders(sql) {
  let index = 0;
  let out = '';
  let quote = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (quote) {
      out += ch;
      if (ch === quote) {
        if (next === quote) {
          out += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (ch === '\'' || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === '?') {
      index += 1;
      out += `$${index}`;
      continue;
    }

    out += ch;
  }

  return out;
}

function translateSqliteSql(sql) {
  return translateSqlitePlaceholders(String(sql || ''))
    .replace(/\bdate\s*\(\s*'now'\s*,\s*'-(\d+)\s+days?'\s*\)/gi, "(CURRENT_DATE - INTERVAL '$1 days')")
    .replace(/\bdate\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE')
    .replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bCURRENT_TIMESTAMP\b/gi, 'CURRENT_TIMESTAMP');
}

function appendReturningId(sql) {
  const trimmed = String(sql || '').trim().replace(/;$/, '');
  if (!/^insert\s+/i.test(trimmed) || /\breturning\b/i.test(trimmed)) return trimmed;
  return `${trimmed} RETURNING id`;
}

function createPostgresAdapter(pool) {
  async function query(sql, params = []) {
    return pool.query(translateSqliteSql(sql), params);
  }

  return {
    async run(sql, ...params) {
      return query(sql, flattenParams(params));
    },

    async all(sql, ...params) {
      const result = await query(sql, flattenParams(params));
      return result.rows;
    },

    async get(sql, ...params) {
      const result = await query(sql, flattenParams(params));
      return result.rows[0];
    },

    async insert(sql, ...params) {
      const result = await query(appendReturningId(sql), flattenParams(params));
      return { lastInsertRowid: result.rows[0]?.id ?? null };
    },

    async exec(sql) {
      return query(sql);
    },

    prepare(sql) {
      const self = this;
      return {
        run(...params) { return self.run(sql, ...params); },
        all(...params) { return self.all(sql, ...params); },
        get(...params) { return self.get(sql, ...params); },
      };
    },
  };
}

module.exports = {
  appendReturningId,
  createPostgresAdapter,
  translateSqliteSql,
};
