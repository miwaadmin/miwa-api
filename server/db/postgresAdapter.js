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

const DATE_LIKE_COLUMNS = [
  'session_date',
  'scheduled_start',
  'scheduled_end',
  'last_session_date',
  'first_session_date',
];

function dateLikeColumnPattern() {
  return `((?:[A-Za-z_][A-Za-z0-9_]*\\.)?(?:(?:[A-Za-z_][A-Za-z0-9_]*_(?:at|date))|(?:${DATE_LIKE_COLUMNS.join('|')})))`;
}

function castDateLikeColumn(column) {
  return `NULLIF(${column}::text, '')::timestamp`;
}

function castTimestampParam(value) {
  if (/^\$\d+$/.test(value)) return `${value}::timestamp`;
  return value;
}

function normalizeDateLikeComparisons(sql) {
  const column = dateLikeColumnPattern();
  const relativeDateExpr = String.raw`\((?:[^()]|\([^()]*\))*\b(?:CURRENT_TIMESTAMP|CURRENT_DATE)\b(?:[^()]|\([^()]*\))*\)|CURRENT_TIMESTAMP|CURRENT_DATE|date_trunc\('month', CURRENT_DATE\)|\$\d+(?:::timestamp)?`;
  const comparison = new RegExp(`\\b${column}\\s*(>=|<=|>|<)\\s*(${relativeDateExpr})`, 'gi');
  const between = new RegExp(`\\b${column}\\s+BETWEEN\\s+(${relativeDateExpr})\\s+AND\\s+(${relativeDateExpr})`, 'gi');

  return String(sql || '')
    .replace(between, (_match, col, left, right) => {
      return `${castDateLikeColumn(col)} BETWEEN ${castTimestampParam(left)} AND ${castTimestampParam(right)}`;
    })
    .replace(comparison, (_match, col, op, right) => {
      return `${castDateLikeColumn(col)} ${op} ${castTimestampParam(right)}`;
    });
}

function translateSqliteSql(sql) {
  const translated = translateSqlitePlaceholders(String(sql || ''))
    .replace(/\s+COLLATE\s+NOCASE/gi, '')
    .replace(/\bCOALESCE\s*\(([^)]*),\s*""\s*\)/gi, "COALESCE($1, '')")
    .replace(/\bORDER\s+BY\s+COALESCE\s*\(\s*((?:[A-Za-z_][A-Za-z0-9_]*\.)?session_date)\s*,\s*((?:[A-Za-z_][A-Za-z0-9_]*\.)?created_at)\s*\)/gi, "ORDER BY COALESCE(NULLIF($1, '')::timestamp, $2::timestamp)")
    .replace(/\bORDER\s+BY\s+COALESCE\s*\(\s*((?:[A-Za-z_][A-Za-z0-9_]*\.)?scheduled_start)\s*,\s*((?:[A-Za-z_][A-Za-z0-9_]*\.)?created_at)\s*\)/gi, "ORDER BY COALESCE(NULLIF($1, '')::timestamp, $2::timestamp)")
    .replace(/\bJULIANDAY\s*\(\s*COALESCE\s*\(([^)]*)\)\s*\)/gi, "(EXTRACT(EPOCH FROM COALESCE($1)::timestamp) / 86400)")
    .replace(/\bJULIANDAY\s*\(\s*([^)]+?)\s*\)/gi, "(EXTRACT(EPOCH FROM $1::timestamp) / 86400)")
    .replace(/\bjson_extract\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*'\$\.([A-Za-z_][A-Za-z0-9_]*)'\s*\)/gi, "($1::jsonb ->> '$2')")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'\+'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*minutes?'\s*\)/gi, "(CURRENT_TIMESTAMP + ($1::int * INTERVAL '1 minute'))")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'-'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*minutes?'\s*\)/gi, "(CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 minute'))")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'\+'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*days?'\s*\)/gi, "(CURRENT_TIMESTAMP + ($1::int * INTERVAL '1 day'))")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'-'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*days?'\s*\)/gi, "(CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day'))")
    .replace(/\bdate\s*\(\s*'now'\s*,\s*'\+'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*days?'\s*\)/gi, "(CURRENT_DATE + ($1::int * INTERVAL '1 day'))")
    .replace(/\bdate\s*\(\s*'now'\s*,\s*'-'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*days?'\s*\)/gi, "(CURRENT_DATE - ($1::int * INTERVAL '1 day'))")
    .replace(/\bdate\s*\(\s*'now'\s*,\s*(\$\d+)\s*\)/gi, "(CURRENT_DATE + ($1::text)::interval)")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*(\$\d+)\s*\)/gi, "(CURRENT_TIMESTAMP + ($1::text)::interval)")
    .replace(/\bdatetime\s*\(\s*(\$\d+)\s*,\s*'\+(\d+)\s+days?'\s*\)/gi, "($1::timestamp + INTERVAL '$2 days')")
    .replace(/\bdatetime\s*\(\s*(\$\d+)\s*,\s*'-(\d+)\s+days?'\s*\)/gi, "($1::timestamp - INTERVAL '$2 days')")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+days?'\s*\)/gi, "(CURRENT_TIMESTAMP - INTERVAL '$1 days')")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'\+(\d+)\s+days?'\s*\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '$1 days')")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+hours?'\s*\)/gi, "(CURRENT_TIMESTAMP - INTERVAL '$1 hours')")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'\+(\d+)\s+hours?'\s*\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '$1 hours')")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+minutes?'\s*\)/gi, "(CURRENT_TIMESTAMP - INTERVAL '$1 minutes')")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*'\+(\d+)\s+minutes?'\s*\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '$1 minutes')")
    .replace(/\bdate\s*\(\s*'now'\s*,\s*'-(\d+)\s+days?'\s*\)/gi, "(CURRENT_DATE - INTERVAL '$1 days')")
    .replace(/\bdate\s*\(\s*'now'\s*,\s*'\+(\d+)\s+days?'\s*\)/gi, "(CURRENT_DATE + INTERVAL '$1 days')")
    .replace(/\bdate\s*\(\s*'now'\s*,\s*'start of month'\s*\)/gi, "date_trunc('month', CURRENT_DATE)")
    .replace(/\bdate\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE')
    .replace(/\bdate\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gi, '($1::date)')
    .replace(/\bDATE\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/g, '($1::date)')
    .replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bCURRENT_TIMESTAMP\b/gi, 'CURRENT_TIMESTAMP');
  return normalizeDateLikeComparisons(translated);
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
      const result = await query(sql, flattenParams(params));
      return {
        changes: result.rowCount ?? 0,
        rowCount: result.rowCount ?? 0,
        rows: result.rows,
      };
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
