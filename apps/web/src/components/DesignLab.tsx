import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-lab.css';
import { navigate } from '../lib/router';
import {
  GROUPS, PRESETS, apply, contrastReport, defaults, isChanged, load, loadSaved, loadUi, parseImport, save, saveUi, shareLink, storeSaved, summary,
  type Contrast, type Group, type Saved, type State, type Ui,
} from '../lib/designLab';

// Design Lab panel (dev server only; mounted from main.tsx behind import.meta.env.DEV). It lives in a shadow root, so the app's own
// global styles (and the options being tried) can never restyle the panel itself. Plain English labels on purpose: this is a decision
// tool, not product UI.

const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.fab { position: fixed; inset-block-end: 16px; inset-inline-end: 16px; z-index: 2147483000; padding: 10px 16px; border-radius: 999px; border: 1px solid #ffffff55; background: #14181c; color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; box-shadow: 0 8px 24px #0008; }
.fab:hover { background: #1d242b; }
.panel { position: fixed; inset-block: 0; z-index: 2147483001; width: min(400px, 100vw); background: #14181c; color: #e8ecef; font: 13px/1.4 system-ui, sans-serif; display: flex; flex-direction: column; box-shadow: 0 0 40px #000a; direction: ltr; }
.panel.end { right: 0; } .panel.start { left: 0; }
.head { padding: 12px 14px; border-bottom: 1px solid #ffffff1f; display: flex; align-items: center; gap: 6px; }
.head h2 { margin: 0; font-size: 15px; flex: 1; color: #fff; }
.body { overflow-y: auto; padding: 4px 14px 96px; flex: 1; scrollbar-width: thin; }
button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid #ffffff2b; background: #1d242b; color: #e8ecef; padding: 6px 10px; }
button:hover:not(:disabled) { background: #28323b; }
button:disabled { opacity: 0.4; cursor: default; }
button.on { background: #e9b949; color: #1a1400; border-color: #e9b949; font-weight: 700; }
button.ghost { border-color: transparent; background: transparent; padding: 4px 8px; }
button.mini { padding: 2px 7px; font-size: 11px; }
.tools { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
.note { color: #9aa6b0; font-size: 12px; margin: 8px 0 0; }
.sec { margin: 16px 0 6px; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.sec b { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #e9b949; flex: 1; }
.sec .count { background: #e9b949; color: #1a1400; border-radius: 999px; padding: 0 7px; font-size: 11px; font-weight: 700; }
.caret { color: #9aa6b0; font-size: 11px; }
.group { margin: 10px 0 14px; }
.label { font-weight: 650; margin-bottom: 6px; color: #fff; display: flex; align-items: center; gap: 6px; }
.label .changed { width: 7px; height: 7px; border-radius: 50%; background: #e9b949; }
.label .push { flex: 1; }
.help { color: #9aa6b0; font-size: 12px; margin: -2px 0 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.sw { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.sw button { padding: 8px; text-align: left; display: flex; flex-direction: column; gap: 6px; }
.dots { display: flex; } .dots i { width: 22px; height: 22px; border-radius: 50%; border: 2px solid #14181c; margin-right: -6px; display: block; }
select, input[type=text], textarea { width: 100%; padding: 7px; border-radius: 8px; background: #1d242b; color: #e8ecef; border: 1px solid #ffffff2b; font: inherit; }
textarea { min-height: 80px; resize: vertical; }
.range { display: flex; align-items: center; gap: 8px; }
.range input[type=range] { flex: 1; accent-color: #e9b949; }
.range .val { min-width: 62px; text-align: right; font-variant-numeric: tabular-nums; color: #fff; }
.list { display: grid; gap: 6px; margin-top: 8px; }
.list button { text-align: left; }
.list small { display: block; color: #9aa6b0; }
.row { display: flex; gap: 6px; align-items: center; }
.row > * { flex: 1; } .row > button { flex: none; }
.foot { position: absolute; inset-inline: 0; inset-block-end: 0; padding: 12px 14px; background: #14181c; border-top: 1px solid #ffffff1f; display: flex; gap: 8px; }
.foot button { flex: 1; }
.contrast { display: grid; gap: 4px; margin-top: 6px; }
.contrast div { display: flex; justify-content: space-between; gap: 8px; }
.ok { color: #6ee7a8; } .mid { color: #f5d06a; } .bad { color: #ff8b8b; }
.badge { background: #ffffff1a; border-radius: 6px; padding: 1px 6px; font-size: 11px; }
.toast { position: absolute; inset-inline: 14px; inset-block-end: 64px; background: #e9b949; color: #1a1400; padding: 8px 10px; border-radius: 8px; font-weight: 650; }
`;

const JUMPS: [string, string][] = [['Home', '/'], ['Inventory', '/inventory'], ['Sales', '/sales'], ['Purchasing', '/purchasing'], ['Finance', '/finance'], ['Accounting', '/accounting'], ['Settings', '/settings']];

function Control({ g, value, onPick }: { g: Group; value: string; onPick: (v: string) => void }) {
  if (g.kind === 'range') {
    const on = value !== '';
    const mid = String(((g.min ?? 0) + (g.max ?? 100)) / 2);
    return (
      <div className="range">
        <input type="range" min={g.min} max={g.max} step={g.step} value={on ? value : mid} onChange={(e) => onPick(e.target.value)} aria-label={g.label} />
        <span className="val">{on ? `${value}${g.unit ?? ''}` : 'off'}</span>
        <button className="mini" disabled={!on} onClick={() => onPick('')}>Off</button>
      </div>
    );
  }
  if (g.kind === 'select') {
    return (
      <select value={value} onChange={(e) => onPick(e.target.value)} aria-label={g.label}>
        {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (g.kind === 'swatches') {
    return (
      <div className="sw">
        {g.options.map((o) => (
          <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onPick(o.value)}>
            <span className="dots">{o.swatch?.map((col, i) => <i key={i} style={{ background: col }} />)}</span>
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="chips">
      {g.options.map((o) => <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onPick(o.value)}>{o.label}</button>)}
    </div>
  );
}

function Panel() {
  const [ui, setUi] = useState<Ui>(loadUi);
  const [state, setState] = useState<State>(load);
  const [saved, setSaved] = useState<Saved[]>(loadSaved);
  const [slots, setSlots] = useState<{ a: State | null; b: State | null }>({ a: null, b: null });
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [presetName, setPresetName] = useState('');
  const [report, setReport] = useState<Contrast[]>([]);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const hist = useRef<{ past: State[]; future: State[]; lastKey: string; at: number }>({ past: [], future: [], lastKey: '', at: 0 });
  const [, bump] = useState(0);

  useEffect(() => { apply(state); save(state); }, [state]);
  useEffect(() => { saveUi(ui); }, [ui]);
  // Contrast is measured on the live page, so re-measure after every change (and when dark mode flips).
  useEffect(() => { const t = setTimeout(() => setReport(contrastReport()), 120); return () => clearTimeout(t); }, [state, dark]);

  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 1800); }, []);

  // Every change goes through here: it records history (merging fast slider drags of one option into a single step).
  const change = useCallback((next: State, key = '') => {
    const h = hist.current; const now = Date.now();
    setState((cur) => {
      if (!(key && key === h.lastKey && now - h.at < 700)) { h.past.push(cur); if (h.past.length > 150) h.past.shift(); }
      h.future = []; h.lastKey = key; h.at = now;
      return next;
    });
    bump((n) => n + 1);
  }, []);
  const set = (key: string, v: string) => change({ ...state, [key]: v }, key);
  const undo = () => { const h = hist.current; const prev = h.past.pop(); if (!prev) return; h.future.push(state); h.lastKey = ''; setState(prev); bump((n) => n + 1); };
  const redo = () => { const h = hist.current; const nxt = h.future.pop(); if (!nxt) return; h.past.push(state); h.lastKey = ''; setState(nxt); bump((n) => n + 1); };

  // Ctrl+Shift+D toggles the panel (also brings back a hidden launcher); Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); setUi((u) => ({ ...u, open: !u.open, hidden: false })); }
      else if (e.key === 'Escape') setUi((u) => (u.open ? { ...u, open: false } : u));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sections = useMemo(() => [...new Set(GROUPS.map((g) => g.section))], []);
  const changedCount = GROUPS.filter((g) => isChanged(g, state)).length;
  const q = query.trim().toLowerCase();
  const matches = (g: Group) => !q || g.label.toLowerCase().includes(q) || g.section.toLowerCase().includes(q) || g.options.some((o) => o.label.toLowerCase().includes(q));

  const copy = async (text: string, ok: string) => {
    try { await navigator.clipboard.writeText(text); say(ok); } catch { window.prompt('Copy this:', text); }
  };
  const surpriseGroups = (groups: Group[]) => {
    const next = { ...state };
    for (const g of groups) {
      if (g.kind === 'range') continue;
      next[g.key] = g.options[Math.floor(Math.random() * g.options.length)]!.value;
    }
    change(next);
  };
  const toggleDark = () => { document.documentElement.classList.toggle('dark'); setDark(document.documentElement.classList.contains('dark')); };
  const toggleSection = (s: string) => setUi((u) => ({ ...u, closed: u.closed.includes(s) ? u.closed.filter((x) => x !== s) : [...u.closed, s] }));
  const savePreset = () => {
    const name = presetName.trim(); if (!name) return;
    const list = [...saved.filter((p) => p.name !== name), { name, state }]; setSaved(list); storeSaved(list); setPresetName(''); say(`Saved "${name}"`);
  };
  const delPreset = (name: string) => { const list = saved.filter((p) => p.name !== name); setSaved(list); storeSaved(list); };
  const applyImport = () => {
    const parsed = parseImport(importText);
    if (!parsed) { say('Could not read that. Paste the JSON line or a share link.'); return; }
    change(parsed); setShowImport(false); setImportText(''); say('Imported');
  };
  const ab = slots.a && slots.b ? (JSON.stringify(state) === JSON.stringify(slots.a) ? 'A' : JSON.stringify(state) === JSON.stringify(slots.b) ? 'B' : '') : '';

  if (!ui.open) {
    return ui.hidden ? null : <button className="fab" onClick={() => setUi({ ...ui, open: true })} aria-label="Open the Design Lab">🎨 Design Lab{changedCount ? ` · ${changedCount}` : ''}</button>;
  }

  const h = hist.current;
  return (
    <aside className={`panel ${ui.side}`} aria-label="Design Lab">
      <div className="head">
        <h2>🎨 Design Lab</h2>
        <button className="ghost" onClick={undo} disabled={!h.past.length} title="Undo">↶</button>
        <button className="ghost" onClick={redo} disabled={!h.future.length} title="Redo">↷</button>
        <button className="ghost" onClick={() => setUi({ ...ui, side: ui.side === 'end' ? 'start' : 'end' })} title="Move the panel to the other side">⇄</button>
        <button className="ghost" onClick={() => setUi({ ...ui, open: false })} aria-label="Close">✕</button>
      </div>
      <div className="body">
        <div className="tools">
          <button onClick={toggleDark}>{dark ? '☀ Light mode' : '☾ Dark mode'}</button>
          <button onClick={() => change(defaults())}>Reset all</button>
          <button onClick={() => copy(shareLink(state), 'Share link copied')}>Copy link</button>
          <button onClick={() => setShowImport((v) => !v)}>Import…</button>
          <button onClick={() => setUi({ ...ui, open: false, hidden: true })} title="Hides the launcher too. Ctrl+Shift+D brings it back.">Hide lab</button>
        </div>
        {showImport && (
          <div className="group">
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste the JSON line from “Copy my choices”, or a share link" />
            <div className="tools"><button className="on" onClick={applyImport}>Apply</button><button onClick={() => setShowImport(false)}>Cancel</button></div>
          </div>
        )}
        <p className="note">Everything applies live and is remembered in this browser. Shortcut: Ctrl+Shift+D. {changedCount ? `${changedCount} option${changedCount === 1 ? '' : 's'} differ from the baked-in look.` : 'Showing the baked-in look.'}</p>

        <div className="sec" style={{ cursor: 'default' }}><b>Jump to a screen</b></div>
        <div className="chips">{JUMPS.map(([name, path]) => <button key={path} onClick={() => navigate(path)}>{name}</button>)}</div>

        <div className="sec" style={{ cursor: 'default' }}><b>Compare A / B</b>{ab && <span className="badge">showing {ab}</span>}</div>
        <div className="row">
          <button onClick={() => { setSlots({ ...slots, a: state }); say('Saved as A'); }}>Save as A</button>
          <button onClick={() => { setSlots({ ...slots, b: state }); say('Saved as B'); }}>Save as B</button>
          <button className="on" disabled={!slots.a || !slots.b} onClick={() => change(ab === 'A' ? slots.b! : slots.a!)}>Flip A ↔ B</button>
        </div>

        <div className="sec" style={{ cursor: 'default' }}><b>Presets</b></div>
        <div className="list">
          {PRESETS.map((p) => <button key={p.name} onClick={() => change({ ...defaults(), ...p.values })}><b>{p.name}</b><small>{p.blurb}</small></button>)}
          <button onClick={() => surpriseGroups(GROUPS)}><b>Surprise me</b><small>Random pick of everything (undo with ↶).</small></button>
        </div>
        {saved.length > 0 && (
          <>
            <div className="sec" style={{ cursor: 'default' }}><b>My presets</b></div>
            <div className="list">
              {saved.map((p) => (
                <div className="row" key={p.name}>
                  <button onClick={() => change({ ...defaults(), ...p.state })}>{p.name}</button>
                  <button className="ghost" onClick={() => delPreset(p.name)} aria-label={`Delete ${p.name}`}>🗑</button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <input type="text" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save current look as…" onKeyDown={(e) => e.key === 'Enter' && savePreset()} />
          <button onClick={savePreset} disabled={!presetName.trim()}>Save</button>
        </div>

        <div className="sec" style={{ cursor: 'default' }}><b>Contrast check (WCAG)</b></div>
        <div className="contrast">
          {report.map((r) => {
            const cls = r.ratio === null ? '' : r.ratio >= 4.5 ? 'ok' : r.ratio >= 3 ? 'mid' : 'bad';
            return <div key={r.label}><span>{r.label}</span><span className={cls}>{r.ratio === null ? '?' : `${r.ratio.toFixed(1)} : 1 ${r.ratio >= 4.5 ? '✓' : r.ratio >= 3 ? '(large text only)' : '✕ too low'}`}</span></div>;
          })}
        </div>

        <div className="sec" style={{ cursor: 'default' }}><b>Find an option</b></div>
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: table, font, radius…" />

        {sections.map((sec) => {
          const groups = GROUPS.filter((g) => g.section === sec && matches(g));
          if (!groups.length) return null;
          const closed = !q && ui.closed.includes(sec);
          const n = groups.filter((g) => isChanged(g, state)).length;
          return (
            <div key={sec}>
              <div className="sec" onClick={() => toggleSection(sec)}>
                <span className="caret">{closed ? '▸' : '▾'}</span>
                <b>{sec}</b>
                {n > 0 && <span className="count">{n}</span>}
                <button className="mini" onClick={(e) => { e.stopPropagation(); surpriseGroups(groups); }} title="Random pick for this section only">Surprise</button>
              </div>
              {!closed && groups.map((g) => (
                <div className="group" key={g.key}>
                  <div className="label">
                    {isChanged(g, state) && <span className="changed" title="Differs from the baked-in look" />}
                    <span className="push">{g.label}</span>
                    {isChanged(g, state) && <button className="mini" onClick={() => set(g.key, g.default)} title="Back to the baked-in value">↺ reset</button>}
                  </div>
                  {g.help && <div className="help">{g.help}</div>}
                  <Control g={g} value={state[g.key] ?? g.default} onPick={(v) => set(g.key, v)} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      <div className="foot">
        <button className="on" onClick={() => copy(summary(state), 'Copied. Paste it to Claude.')}>Copy my choices</button>
      </div>
    </aside>
  );
}

export function mountDesignLab() {
  apply(load());   // choices apply at once, even before the panel is opened
  const host = document.createElement('div');
  host.id = 'design-lab-root';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const mount = document.createElement('div');
  shadow.append(style, mount);
  createRoot(mount).render(<Panel />);
}
