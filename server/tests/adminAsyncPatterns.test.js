const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin routes do not chain array methods onto unresolved db.all promises', () => {
  const adminRoutesPath = path.join(__dirname, '..', 'routes', 'admin.js');
  const source = fs.readFileSync(adminRoutesPath, 'utf8');
  const statements = [];

  let index = source.indexOf('await db.all(');
  while (index !== -1) {
    const end = source.indexOf(';', index);
    statements.push(source.slice(index, end === -1 ? source.length : end + 1));
    index = source.indexOf('await db.all(', index + 1);
  }

  assert.equal(statements.some(statement => /\.(map|reverse|sort|filter)\s*\(/.test(statement)), false);
});
