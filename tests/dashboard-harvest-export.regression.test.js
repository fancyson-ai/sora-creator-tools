const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function extractSnippet(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start not found`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label} end not found`);
  return source.slice(start, end);
}

function buildHarness() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'const HARVEST_EXPORT_COLUMNS = [',
    'function downloadTextFile(filename, text, mimeType) {',
    'dashboard harvest export snippet'
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `
function joinHarvestList(values) {
  if (!Array.isArray(values)) return '';
  return values
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join('|');
}
function escapeCSV(str) {
  if (str == null) return '';
  const s = String(str);
  if (s.includes(',') || s.includes('"') || s.includes('\\n') || s.includes('\\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
${snippet}
globalThis.__buildHarvestCsv = buildHarvestCsv;
globalThis.__buildHarvestJsonl = buildHarvestJsonl;
globalThis.__buildHarvestExportRows = buildHarvestExportRows;
`,
    context,
    { filename: 'dashboard-harvest-export.harness.js' }
  );
  return {
    buildHarvestCsv: context.__buildHarvestCsv,
    buildHarvestJsonl: context.__buildHarvestJsonl,
    buildHarvestExportRows: context.__buildHarvestExportRows,
  };
}

test('buildHarvestExportRows joins cast arrays and keeps schema fields', () => {
  const { buildHarvestExportRows } = buildHarness();
  const rows = buildHarvestExportRows([
    {
      recordKey: 'published:p_1',
      id: 'p_1',
      kind: 'published',
      cast_names: ['alice', 'bob'],
      cameos: ['charlie'],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].record_key, 'published:p_1');
  assert.equal(rows[0].cast_names, 'alice|bob');
  assert.equal(rows[0].cameos, 'charlie');
});

test('buildHarvestCsv escapes quoted prompt text', () => {
  const { buildHarvestCsv } = buildHarness();
  const csv = buildHarvestCsv([
    {
      recordKey: 'draft:d_1',
      id: 'd_1',
      kind: 'draft',
      prompt: 'scene with "quotes", commas, and detail',
      cast_names: [],
      cameos: [],
    },
  ]);
  assert.match(csv, /record_key,id,kind,context,source/);
  assert.match(csv, /"scene with ""quotes"", commas, and detail"/);
});

test('buildHarvestJsonl outputs one line per record', () => {
  const { buildHarvestJsonl } = buildHarness();
  const jsonl = buildHarvestJsonl([
    { recordKey: 'published:p_1', id: 'p_1', kind: 'published' },
    { recordKey: 'draft:d_1', id: 'd_1', kind: 'draft' },
  ]);
  const lines = jsonl.split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).record_key, 'published:p_1');
  assert.equal(JSON.parse(lines[1]).record_key, 'draft:d_1');
});
