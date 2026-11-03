import { useEffect } from 'react';

// On a phone every table becomes a stack of cards, and each cell shows its column name (styles.css reads `data-label`). The shared
// ListView sets the labels itself; this fills them in for every other table in the app, by copying each <thead> cell's text onto the
// cells of its column. It runs once after each change to the page (batched to one animation frame) and only touches cells that have
// no label yet, so it costs nothing on screens that do not change. Labels are read from the rendered headers, so they follow the
// language in use.

function label(table: HTMLTableElement) {
  const heads = Array.from(table.tHead?.rows[0]?.cells ?? []).map((th) => th.textContent?.trim() ?? '');
  if (!heads.length) return;
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        if (!cell.hasAttribute('data-label') && cell.colSpan === 1) cell.setAttribute('data-label', heads[col] ?? '');
        col += cell.colSpan;
      }
    }
  }
}

export function TableLabels() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      document.querySelectorAll<HTMLTableElement>('.table-wrap table').forEach(label);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(run); };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return null;
}
