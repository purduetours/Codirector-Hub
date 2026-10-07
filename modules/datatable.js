/* ============================================================ reusable table
   The same sortable, selectable table for every roster-like screen (Tour Guides,
   Evaluation Roster, Remembered matches, Evaluators). It only draws and sorts;
   each page owns its data and what the buttons do, so there is one look and one
   keyboard behaviour, and no page re-implements sorting.

   Usage
     const t = { sort: { key: 'name', dir: 1 }, selected: new Set() };
     host.innerHTML = tableHtml({ columns, rows: sortRows(rows, columns, t.sort), sort: t.sort, selected: t.selected, rowKey: r => r.id });
     bindTable(host, { onSort: key => …, onToggle: (id, on) => …, onToggleAll: on => … });
   A column: { key, label, sortable?, value?(row) for sorting, render?(row) -> html, className? }.
============================================================================ */
import { esc } from '../core/ui.js';

export function sortRows(rows, columns, sort) {
  const col = columns.find(c => c.key === sort?.key);
  if (!col || !col.sortable) return rows;
  const val = r => { const v = col.value ? col.value(r) : r[col.key]; return v == null ? '' : v; };
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    return c * (sort.dir || 1);
  });
}

export function tableHtml({ columns, rows, sort, selected, rowKey, selectable = true, empty = '' }) {
  if (!rows.length) return empty;
  const allOn = selectable && rows.every(r => selected?.has(rowKey(r)));
  return `<div class="dt-wrap"><table class="dt">
    <thead><tr>${selectable ? `<th class="dt-sel"><input type="checkbox" data-dt-all aria-label="Select all shown" ${allOn ? 'checked' : ''}></th>` : ''}
      ${columns.map(c => `<th class="${esc(c.className || '')}" ${c.sortable ? `aria-sort="${sort?.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"` : ''}>
        ${c.sortable ? `<button type="button" class="dt-sort" data-dt-sort="${esc(c.key)}">${esc(c.label)}<span aria-hidden="true">${sort?.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</span></button>` : esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr data-dt-row="${esc(rowKey(r))}" class="${selected?.has(rowKey(r)) ? 'is-picked' : ''}">
      ${selectable ? `<td class="dt-sel"><input type="checkbox" data-dt-pick aria-label="Select ${esc(r.name || r.full_name || 'row')}" ${selected?.has(rowKey(r)) ? 'checked' : ''}></td>` : ''}
      ${columns.map(c => `<td class="${esc(c.className || '')}">${c.render ? c.render(r) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function bindTable(root, { onSort, onToggle, onToggleAll }) {
  root.addEventListener('click', e => { const b = e.target.closest('[data-dt-sort]'); if (b) onSort?.(b.dataset.dtSort); });
  root.addEventListener('change', e => {
    if (e.target.matches('[data-dt-all]')) onToggleAll?.(e.target.checked);
    else if (e.target.matches('[data-dt-pick]')) onToggle?.(e.target.closest('tr').dataset.dtRow, e.target.checked);
  });
}

export const nextSort = (sort, key) => ({ key, dir: sort?.key === key ? -sort.dir : 1 });
