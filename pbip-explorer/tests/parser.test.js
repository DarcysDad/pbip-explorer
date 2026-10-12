// Run with:  node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/js/parser.js');
const demo = require('./demo-files.json');

const known = names => new Set(names);

test('analyzeDax: quoted table names containing brackets', () => {
  const d = p.analyzeDax("SUM('[Sales] Daily Snapshot'[Amount])", known(['[Sales] Daily Snapshot']));
  assert.deepEqual(d.columns, [{ table: '[Sales] Daily Snapshot', column: 'Amount' }]);
  assert.deepEqual(d.names, []);
});

test('analyzeDax: adjacent quoted references do not merge into a phantom table', () => {
  const d = p.analyzeDax("'A'[x] + '[B]'[y]", known(['A', '[B]']));
  assert.deepEqual(d.columns.map(c => c.table), ['A', '[B]']);
});

test("analyzeDax: '' escapes inside table names and ]] inside column names", () => {
  const d = p.analyzeDax("SUM('O''Brien Sales'[Net ]]Amount])", known(["O'Brien Sales"]));
  assert.deepEqual(d.columns, [{ table: "O'Brien Sales", column: 'Net ]Amount' }]);
});

test('analyzeDax: bare tables, bare measures, function calls', () => {
  const d = p.analyzeDax('DIVIDE([Gross Margin], SUM(Sales[Amount]))', known(['Sales']));
  assert.deepEqual(d.names, ['Gross Margin']);
  assert.deepEqual(d.columns, [{ table: 'Sales', column: 'Amount' }]);
});

test('analyzeDax: table lookup is case-insensitive', () => {
  const d = p.analyzeDax('COUNTROWS(sales)', known(['Sales']));
  assert.deepEqual(d.tables, ['sales']);
});

test('analyzeDax: references inside strings and comments are ignored', () => {
  const d = p.analyzeDax('-- [Old Measure]\n"[Not a ref]" & [Real] /* [Also not] */', known([]));
  assert.deepEqual(d.names, ['Real']);
});

test('analyzeDax: SUMMARIZE / ADDCOLUMNS extension columns are locals', () => {
  const d = p.analyzeDax('SUMX(ADDCOLUMNS(VALUES(Store[Store]), "@Sales", [Total Sales]), [@Sales])', known(['Store']));
  assert.deepEqual(d.locals, ['@Sales']);
  assert.ok(d.names.includes('@Sales'));
});

test('analyzeM: SQL source with schema/item navigation', () => {
  const m = p.analyzeM('let Source = Sql.Database("srv", "db"), T = Source{[Schema="dbo",Item="Fact"]}[Data] in T');
  assert.equal(m.kind, 'Sql.Database');
  assert.equal(m.details.server, 'srv');
  assert.equal(m.details.database, 'db');
  assert.equal(m.details.item, 'Fact');
});

test('splitColumnRef: dots inside quoted table names', () => {
  assert.deepEqual(p.splitColumnRef("'v1.2 Sales'.'Net.Amount'"), { table: 'v1.2 Sales', column: 'Net.Amount' });
});

test('parseModel: demo project round-trips', () => {
  const m = p.parseModel(demo.filter(f => f.path.endsWith('.tmdl')));
  assert.equal(Object.keys(m.tables).length, 9);
  assert.equal(m.relationships.length, 8);
  assert.equal(m.relationships.filter(r => !r.isActive).length, 1);
  assert.equal(m.fileErrors.length, 0);
  const lm = m.columns.find(c => c.name === 'Line Margin');
  assert.ok(lm.isCalculated);
  assert.equal(lm.expression, 'Sales[Amount] - Sales[Cost]');
  const multi = m.measures.find(x => x.name === 'Sales by Ship Date');
  assert.match(multi.expression, /USERELATIONSHIP/);
  assert.equal(m.tables['Report Measures'].isCalculated, true);
});

test('formatDax: keeps references intact', () => {
  const out = p.formatDax("CALCULATE([Total Sales], 'Date'[Year] = 2026)");
  assert.match(out, /\[Total Sales\]/);
  assert.match(out, /'Date'\[Year\]/);
});

test('analyzeM: parameterised connection arguments resolve to parameter names', () => {
  const m = p.analyzeM('let Source = Sql.Database(#"Server", #"Database"), T = Source{[Schema="dw",Item="FactSales"]}[Data] in T');
  assert.equal(m.kind, 'Sql.Database');
  assert.equal(m.details.server, 'Server');
  assert.equal(m.details.database, 'Database');
  assert.equal(m.details.item, 'FactSales');
});
