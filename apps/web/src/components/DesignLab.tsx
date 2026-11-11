import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-lab.css';
import { GROUPS, PRESETS, apply, defaults, load, save, summary, type Group, type State } from '../lib/designLab';

// Design Lab panel (dev server only; mounted from main.tsx behind import.meta.env.DEV). Fixed dark styling of its own so it stays
// readable whatever palette is being tried. Plain English labels on purpose: this is a throwaway decision tool, not product UI.

const PANEL_CSS = `
.dl-fab { position: fixed; inset-block-end: 16px; inset-inline-end: 16px; z-index: 2147483000; padding: 0.65rem 1rem; border-radius: 999px; border: 1px solid #ffffff55; background: #14181c; color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; box-shadow: 0 8px 24px #0008; }
.dl-fab:hover:not(:disabled) { background: #1d242b; }
.dl-panel { position: fixed; inset-block: 0; inset-inline-end: 0; width: min(380px, 100vw); z-index: 2147483001; background: #14181c; color: #e8ecef; font: 13px/1.4 system-ui, sans-serif; display: flex; flex-direction: column; box-shadow: -12px 0 40px #0009; direction: ltr; }
.dl-panel * { box-sizing: border-box; }
.dl-head { padding: 14px 16px; border-bottom: 1px solid #ffffff1f; display: flex; align-items: center; gap: 8px; }
.dl-head h2 { margin: 0; font-size: 15px; flex: 1; color: #fff; }
.dl-body { overflow-y: auto; padding: 8px 16px 90px; flex: 1; }
.dl-panel button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid #ffffff2b; background: #1d242b; color: #e8ecef; padding: 6px 10px; }
.dl-panel button:hover:not(:disabled) { background: #28323b; }
.dl-panel button.on { background: #e9b949; color: #1a1400; border-color: #e9b949; font-weight: 700; }
.dl-sec { margin: 18px 0 6px; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #e9b949; font-weight: 700; }
.dl-group { margin: 10px 0 14px; }
.dl-label { font-weight: 650; margin-bottom: 6px; color: #fff; }
.dl-help { color: #9aa6b0; font-size: 12px; margin: -2px 0 6px; }
.dl-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dl-sw { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.dl-sw button { padding: 8px; text-align: start; display: flex; flex-direction: column; gap: 6px; }
.dl-dots { display: flex; }
.dl-dots i { width: 22px; height: 22px; border-radius: 50%; border: 2px solid #14181c; margin-inline-end: -6px; display: block; }
.dl-panel select { width: 100%; padding: 7px; border-radius: 8px; background: #1d242b; color: #e8ecef; border: 1px solid #ffffff2b; font: inherit; }
.dl-presets { display: grid; gap: 6px; margin-top: 10px; }
.dl-presets button { text-align: start; }
.dl-presets small { display: block; color: #9aa6b0; }
.dl-foot { position: absolute; inset-block-end: 0; inset-inline: 0; padding: 12px 16px; background: #14181c; border-top: 1px solid #ffffff1f; display: flex; gap: 8px; }
.dl-foot button { flex: 1; }
.dl-note { color: #9aa6b0; font-size: 12px; margin: 10px 0 0; }
`;

function Chips({ g, value, onPick }: { g: Group; value: string; onPick: (v: string) => void }) {
  if (g.kind === 'select') {
    return (
      <select value={value} onChange={(e) => onPick(e.target.value)} aria-label={g.label}>
        {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (g.kind === 'swatches') {
    return (
      <div className="dl-sw">
        {g.options.map((o) => (
          <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onPick(o.value)}>
            <span className="dl-dots">{o.swatch?.map((col, i) => <i key={i} style={{ background: col }} />)}</span>
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="dl-chips">
      {g.options.map((o) => <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onPick(o.value)}>{o.label}</button>)}
    </div>
  );
}

function Panel() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>(load);
  const [copied, setCopied] = useState(false);
  useEffect(() => { apply(state); save(state); }, [state]);
  const sections = useMemo(() => [...new Set(GROUPS.map((g) => g.section))], []);
  const set = (key: string, v: string) => setState((s) => ({ ...s, [key]: v }));

  const copy = async () => {
    try { await navigator.clipboard.writeText(summary(state)); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt('Copy this and send it to Claude:', summary(state)); }
  };
  const surprise = () => setState(Object.fromEntries(GROUPS.map((g) => [g.key, g.options[Math.floor(Math.random() * g.options.length)]!.value])));

  return (
    <>
      <style>{PANEL_CSS}</style>
      {!open && <button className="dl-fab" onClick={() => setOpen(true)} aria-label="Open the Design Lab">🎨 Design Lab</button>}
      {open && (
        <aside className="dl-panel" aria-label="Design Lab">
          <div className="dl-head">
            <h2>🎨 Design Lab</h2>
            <button onClick={() => setState(defaults())}>Reset</button>
            <button onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          <div className="dl-body">
            <p className="dl-note">Every choice applies live and is remembered in this browser. Try the dark-mode and Arabic (RTL) switches too. When you are happy, press "Copy my choices" and paste the result to Claude.</p>
            <div className="dl-sec">Presets</div>
            <div className="dl-presets">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => setState({ ...defaults(), ...p.values })}>
                  <b>{p.name}</b><small>{p.blurb}</small>
                </button>
              ))}
              <button onClick={surprise}><b>Surprise me</b><small>Random pick of everything.</small></button>
            </div>
            {sections.map((sec) => (
              <div key={sec}>
                <div className="dl-sec">{sec}</div>
                {GROUPS.filter((g) => g.section === sec).map((g) => (
                  <div className="dl-group" key={g.key}>
                    <div className="dl-label">{g.label}</div>
                    {g.help && <div className="dl-help">{g.help}</div>}
                    <Chips g={g} value={state[g.key] ?? g.default} onPick={(v) => set(g.key, v)} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="dl-foot">
            <button className="on" onClick={copy}>{copied ? 'Copied ✓' : 'Copy my choices'}</button>
          </div>
        </aside>
      )}
    </>
  );
}

export function mountDesignLab() {
  apply(load());   // choices apply at once, even before the panel is opened
  const host = document.createElement('div');
  host.id = 'design-lab-root';
  document.body.appendChild(host);
  createRoot(host).render(<Panel />);
}
