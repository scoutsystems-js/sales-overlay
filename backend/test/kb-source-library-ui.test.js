'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fnBody, stripComments } = require('./helpers/strip-comments');

const page = stripComments(fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8'));

function runList(items, filters) {
  const nodes = { kbContainer: { innerHTML: '' }, kbRailMount: { innerHTML: '' }, kbStatsMount: { innerHTML: '' } };
  const state = { kbLibraryFilters: filters || {}, kbLibraryItems: items };
  const names = ['kbCategoryLabel', 'kbResourceKind', 'kbFilterItems', 'kbLibrarySetFilter', 'kbLibraryFilterHtml', 'renderKbList'];
  const source = names.map((name) => fnBody(page, name)).join('\n') + '; return renderKbList;';
  const render = new Function('state', 'document', 'escapeHtml', 'relativeTime', 'kbCanManage', 'kbCanPromote', source)(
    state,
    { getElementById: (id) => nodes[id] || null },
    (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    () => 'today',
    () => true,
    () => true
  );
  render(items);
  return nodes;
}

test('Knowledge Base source library retains every resource and adds usable source filters', () => {
  const items = [
    { source_label: 'Sales script', category: 'script', scope: 'team', created_at: '2026-09-14' },
    { source_label: 'Close moment', category: 'call_moment', scope: 'personal', created_at: '2026-09-13' },
  ];
  const nodes = runList(items);
  assert.match(nodes.kbRailMount.innerHTML, /All resources/);
  assert.match(nodes.kbRailMount.innerHTML, /Stored moments/);
  assert.match(nodes.kbStatsMount.innerHTML, /Resources Scout can use/);
  assert.match(nodes.kbContainer.innerHTML, /Sales script/);
  assert.match(nodes.kbContainer.innerHTML, /Close moment/);
  assert.match(nodes.kbContainer.innerHTML, /Share with team/);
});

test('Knowledge Base filters only change the library view', () => {
  const nodes = runList([
    { source_label: 'Sales script', category: 'script', scope: 'team', created_at: '2026-09-14' },
    { source_label: 'Close moment', category: 'call_moment', scope: 'personal', created_at: '2026-09-13' },
  ], { kind: 'moment', sort: 'newest' });
  assert.doesNotMatch(nodes.kbContainer.innerHTML, /Sales script/);
  assert.match(nodes.kbContainer.innerHTML, /Close moment/);
});
