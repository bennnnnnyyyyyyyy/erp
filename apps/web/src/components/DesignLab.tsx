import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-lab.css';
import { navigate } from '../lib/router';
import {
  GROUPS, PRESETS, SRC_LABEL, apply, backfill, contrastReport, defaults, describeEntry, diffEntries, isChanged, load, loadLog, loadSaved, loadTouched, loadUi,
  parseImport, save, saveLog, saveTouched, saveUi, shareLink, stampOf, storeSaved, summary,
  type Contrast, type Entry, type Group, type Saved, type Source, type State, type Touched, type Ui,
} from '../lib/designLab';

// Design Lab panel (dev server only; mounted from main.tsx behind import.meta.env.DEV). It lives in a shadow root, so the app's own
// global styles (and the options being tried) can never restyle the panel itself. Plain English labels on purpose: this is a decision
// tool, not product UI.
//
// Memory of what Ben did: every option is "chosen by you" (clicked directly), "via preset" (set by a preset, Surprise or an import, so
// not an individual decision), or "not touched". Every change is also written to a timestamped log. Both survive reloads.

const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.fab { position: fixed; inset-block-end: 16px; inset-inline-end: 16px; z-index: 2147483000; padding: 10px 16px; border-radius: 999px; border: 1px solid #ffffff55; background: #14181c; color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; box-shadow: 0 8px 24px #0008; }
.fab:hover { background: #1d242b; }
.panel { position: fixed; inset-block: 0; z-index: 2147483001; width: min(420px, 100vw); background: #14181c; color: #e8ecef; font: 13px/1.4 system-ui, sans-serif; display: flex; flex-direction: column; box-shadow: 0 0 40px #000a; direction: ltr; }
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
.sec .of { color: #9aa6b0; font-size: 11px; }
.caret { color: #9aa6b0; font-size: 11px; }
.group { margin: 10px 0 14px; }
.label { font-weight: 650; margin-bottom: 6px; color: #fff; display: flex; align-items: center; gap: 6px; }
.label .push { flex: 1; }
.tag { font-size: 10px; font-weight: 700; border-radius: 6px; padding: 1px 6px; letter-spacing: 0.03em; }
.tag.user { background: #1f6f4a; color: #d9ffe9; }
.tag.preset { background: #2a4a7a; color: #d9e8ff; }
.tag.none { background: #ffffff14; color: #9aa6b0; font-weight: 500; }
.dotc { width: 7px; height: 7px; border-radius: 50%; background: #e9b949; }
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
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }
.stats div { background: #ffffff0f; border-radius: 8px; padding: 6px 8px; }
.stats b { display: block; font-size: 18px; color: #fff; }
.stats span { font-size: 11px; color: #9aa6b0; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.log { margin-top: 6px; max-height: 260px; overflow-y: auto; border: 1px solid #ffffff1f; border-radius: 8px; padding: 4px 8px; scrollbar-width: thin; }
.log div { padding: 4px 0; border-bottom: 1px solid #ffffff12; font-size: 12px; }
.log div:last-child { border-bottom: 0; }
.log time { color: #9aa6b0; font-size: 11px; display: block; }
`;

const JUMPS: [string, string][] = [['Home', '/'], ['Inventory', '/inventory'], ['Sales', '/sales'], ['Purchasing', '/purchasing'], ['Finance', '/finance'], ['Accounting', '/accounting'], ['Settings', '/settings']];
type Filter = 'all' | 'untouched' | 'user' | 'preset' | 'changed';
const FILTERS: [Filter, string][] = [['all', 'All'], ['untouched', 'Not touched'], ['user', 'Chosen by me'], ['preset', 'Via preset'], ['changed', 'Differs from default']];

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
  const [tracking] = useState(() => backfill(load()));   // null once tracking has started
  const [log, setLog] = useState<Entry[]>(() => tracking?.log ?? loadLog());
  const [touched, setTouched] = useState<Touched>(() => tracking?.touched ?? loadTouched());
  const [filter, setFilter] = useState<Filter>('all');
  const [slots, setSlots] = useState<{ a: State | null; b: State | null }>({ a: null, b: null });
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [presetName, setPresetName] = useState('');
  const [report, setReport] = useState<Contrast[]>([]);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const hist = useRef<{ past: State[]; future: State[]; lastKey: string; at: number }>({ past: [], future: [], lastKey: '', at: 0 });
  const lastLog = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [, bump] = useState(0);

  useEffect(() => { apply(state); save(state); }, [state]);
  useEffect(() => { saveUi(ui); }, [ui]);
  useEffect(() => { saveLog(log); }, [log]);
  useEffect(() => { saveTouched(touched); }, [touched]);
  // Contrast is measured on the live page, so re-measure after every change (and when dark mode flips).
  useEffect(() => { const t = setTimeout(() => setReport(contrastReport()), 120); return () => clearTimeout(t); }, [state, dark]);

  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 1800); }, []);

  // Record what changed: log entries, plus who decided it ("user" = Ben clicked that very option; bulk actions only mark "preset").
  const record = useCallback((prev: State, next: State, src: Source, key: string) => {
    const entries = diffEntries(prev, next, src);
    if (src === 'reset') { setTouched({}); }
    else if (src === 'user' || src === 'preset' || src === 'random' || src === 'import') {
      setTouched((t) => {
        const out = { ...t };
        const keys = entries.map((e) => e.key);
        if (src === 'user' && key && !keys.includes(key)) keys.push(key);   // clicking the value it already has still counts as a decision
        for (const k of keys) { if (src === 'user') out[k] = 'user'; else if (out[k] !== 'user') out[k] = 'preset'; }
        return out;
      });
    }
    if (src === 'user' && key && !entries.length) entries.push({ t: new Date().toISOString(), key, from: prev[key] ?? '', to: prev[key] ?? '', src });
    if (!entries.length) return;
    const now = Date.now();
    setLog((cur) => {
      const last = cur[cur.length - 1];
      // a slider drag is one log line, not fifty
      if (src === 'user' && entries.length === 1 && last && last.key === entries[0]!.key && last.src === 'user' && lastLog.current.key === key && now - lastLog.current.at < 700) {
        return [...cur.slice(0, -1), { ...last, to: entries[0]!.to }];
      }
      return [...cur, ...entries];
    });
    lastLog.current = { key, at: now };
  }, []);

  // Every change goes through here: it records history (merging fast slider drags of one option into one undo step) and the log.
  const change = useCallback((next: State, key = '', src: Source = 'user') => {
    const h = hist.current; const now = Date.now();
    const cur = stateRef.current;
    record(cur, next, src, key);
    if (JSON.stringify(cur) !== JSON.stringify(next)) {
      if (!(key && key === h.lastKey && now - h.at < 700)) { h.past.push(cur); if (h.past.length > 150) h.past.shift(); }
      h.future = []; h.lastKey = key; h.at = now;
      setState(next);
    }
    bump((n) => n + 1);
  }, [record]);
  const set = (key: string, v: string) => change({ ...state, [key]: v }, key, 'user');
  const undo = () => { const h = hist.current; const prev = h.past.pop(); if (!prev) return; h.future.push(state); h.lastKey = ''; record(state, prev, 'undo', ''); setState(prev); bump((n) => n + 1); };
  const redo = () => { const h = hist.current; const nxt = h.future.pop(); if (!nxt) return; h.past.push(state); h.lastKey = ''; record(state, nxt, 'redo', ''); setState(nxt); bump((n) => n + 1); };

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
  const nUser = GROUPS.filter((g) => touched[g.key] === 'user').length;
  const nPreset = GROUPS.filter((g) => touched[g.key] === 'preset').length;
  const nNone = GROUPS.length - nUser - nPreset;
  const q = query.trim().toLowerCase();
  const filtering = filter !== 'all' || !!q;
  const matches = (g: Group) => {
    if (q && !(g.label.toLowerCase().includes(q) || g.section.toLowerCase().includes(q) || g.options.some((o) => o.label.toLowerCase().includes(q)))) return false;
    if (filter === 'untouched') return !touched[g.key];
    if (filter === 'user') return touched[g.key] === 'user';
    if (filter === 'preset') return touched[g.key] === 'preset';
    if (filter === 'changed') return isChanged(g, state);
    return true;
  };

  const copy = async (text: string, ok: string) => {
    try { await navigator.clipboard.writeText(text); say(ok); } catch { window.prompt('Copy this:', text); }
  };
  const surpriseGroups = (groups: Group[]) => {
    const next = { ...state };
    for (const g of groups) {
      if (g.kind === 'range') continue;
      next[g.key] = g.options[Math.floor(Math.random() * g.options.length)]!.value;
    }
    change(next, '', 'random');
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
    change(parsed, '', 'import'); setShowImport(false); setImportText(''); say('Imported');
  };
  const logText = () => [...log].reverse().map((e) => `${stampOf(e.t)}  [${SRC_LABEL[e.src]}]  ${describeEntry(e)}`).join('\n') || '(empty)';
  const download = () => {
    const blob = new Blob([summary(state, touched, log) + '\n\nFull log (newest first):\n' + logText()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `design-lab-report-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); say('Report downloaded');
  };
  const ab = slots.a && slots.b ? (JSON.stringify(state) === JSON.stringify(slots.a) ? 'A' : JSON.stringify(state) === JSON.stringify(slots.b) ? 'B' : '') : '';

  if (!ui.open) {
    return ui.hidden ? null : <button className="fab" onClick={() => setUi({ ...ui, open: true })} aria-label="Open the Design Lab">🎨 Design Lab{nUser ? ` · ${nUser}/${GROUPS.length} decided` : ''}</button>;
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
        <div className="stats" aria-label="Progress">
          <div><b>{nUser}</b><span>chosen by you</span></div>
          <div><b>{nPreset}</b><span>via preset / surprise</span></div>
          <div><b>{nNone}</b><span>not touched</span></div>
        </div>
        <div className="filters">
          {FILTERS.map(([f, name]) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{name}</button>)}
        </div>
        <p className="note">Everything is remembered: which options you chose yourself, which came from a preset, which you never touched, plus a time-stamped log. {changedCount} differ from the baked-in look. Shortcut: Ctrl+Shift+D.</p>

        <div className="tools">
          <button onClick={toggleDark}>{dark ? '☀ Light mode' : '☾ Dark mode'}</button>
          <button onClick={() => { if (window.confirm('Reset every option to the baked-in look and forget which ones you chose? (The log is kept.)')) change(defaults(), '', 'reset'); }}>Reset all</button>
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

        <div className="sec" onClick={() => toggleSection('__log')}>
          <span className="caret">{ui.closed.includes('__log') ? '▸' : '▾'}</span><b>Change log</b><span className="of">{log.length} entries</span>
        </div>
        {!ui.closed.includes('__log') && (
          <>
            <div className="log" role="log" aria-label="Change log">
              {log.length === 0 && <div>Nothing changed yet.</div>}
              {[...log].reverse().slice(0, 150).map((e, i) => (
                <div key={`${e.t}-${e.key}-${i}`}><time>{stampOf(e.t)} · {SRC_LABEL[e.src]}</time>{describeEntry(e)}</div>
              ))}
            </div>
            <div className="tools">
              <button onClick={() => copy(logText(), 'Log copied')}>Copy log</button>
              <button onClick={download}>Download report</button>
              <button onClick={() => { if (window.confirm('Clear the change log? (Your options and the chosen/not-touched marks stay.)')) setLog([]); }}>Clear log</button>
            </div>
          </>
        )}

        <div className="sec" style={{ cursor: 'default' }}><b>Jump to a screen</b></div>
        <div className="chips">{JUMPS.map(([name, path]) => <button key={path} onClick={() => navigate(path)}>{name}</button>)}</div>

        <div className="sec" style={{ cursor: 'default' }}><b>Compare A / B</b>{ab && <span className="badge">showing {ab}</span>}</div>
        <div className="row">
          <button onClick={() => { setSlots({ ...slots, a: state }); say('Saved as A'); }}>Save as A</button>
          <button onClick={() => { setSlots({ ...slots, b: state }); say('Saved as B'); }}>Save as B</button>
          <button className="on" disabled={!slots.a || !slots.b} onClick={() => change(ab === 'A' ? slots.b! : slots.a!, '', 'preset')}>Flip A ↔ B</button>
        </div>

        <div className="sec" style={{ cursor: 'default' }}><b>Presets</b></div>
        <div className="list">
          {PRESETS.map((p) => <button key={p.name} onClick={() => change({ ...defaults(), ...p.values }, '', 'preset')}><b>{p.name}</b><small>{p.blurb}</small></button>)}
          <button onClick={() => surpriseGroups(GROUPS)}><b>Surprise me</b><small>Random pick of everything (undo with ↶).</small></button>
        </div>
        {saved.length > 0 && (
          <>
            <div className="sec" style={{ cursor: 'default' }}><b>My presets</b></div>
            <div className="list">
              {saved.map((p) => (
                <div className="row" key={p.name}>
                  <button onClick={() => change({ ...defaults(), ...p.state }, '', 'preset')}>{p.name}</button>
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

        <div className="sec" style={{ cursor: 'default' }}><b>Find an option ({GROUPS.length})</b></div>
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: table, font, radius…" />

        {sections.map((sec) => {
          const all = GROUPS.filter((g) => g.section === sec);
          const groups = all.filter(matches);
          if (!groups.length) return null;
          const closed = !filtering && ui.closed.includes(sec);
          const decided = all.filter((g) => touched[g.key]).length;
          return (
            <div key={sec}>
              <div className="sec" onClick={() => toggleSection(sec)}>
                <span className="caret">{closed ? '▸' : '▾'}</span>
                <b>{sec}</b>
                <span className="of">{decided}/{all.length} touched</span>
                <button className="mini" onClick={(e) => { e.stopPropagation(); surpriseGroups(groups); }} title="Random pick for this section only">Surprise</button>
              </div>
              {!closed && groups.map((g) => {
                const status = touched[g.key];
                return (
                  <div className="group" key={g.key}>
                    <div className="label">
                      {isChanged(g, state) && <span className="dotc" title="Differs from the baked-in look" />}
                      <span className="push">{g.label}</span>
                      <span className={`tag ${status ?? 'none'}`}>{status === 'user' ? '✓ chosen by you' : status === 'preset' ? 'via preset' : 'not touched'}</span>
                      {isChanged(g, state) && <button className="mini" onClick={() => set(g.key, g.default)} title="Back to the baked-in value (counts as your decision)">↺ reset</button>}
                    </div>
                    {g.help && <div className="help">{g.help}</div>}
                    <Control g={g} value={state[g.key] ?? g.default} onPick={(v) => set(g.key, v)} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      <div className="foot">
        <button className="on" onClick={() => copy(summary(state, touched, log), 'Copied. Paste it to Claude.')}>Copy my choices</button>
        <button onClick={download}>Download</button>
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
