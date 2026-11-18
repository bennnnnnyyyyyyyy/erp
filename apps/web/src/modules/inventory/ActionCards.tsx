import type { ReactNode } from 'react';
import { Link } from '../../lib/router';

// Big, plainly worded choices: a title, one line saying what it does, and where it goes (or what it does when pressed).
// Used by the Inventory overview ("What do you want to do?") and by the Receive goods and Count stock pages.

/** A plain symbol per kind of action (no icon library; reads the same in Arabic). Keys from overviewActions.ts. */
const ACTION_ICONS: Record<string, string> = { receive: '↓', send: '↑', move: '⇄', count: '#', correct: '±' };

export type ActionCard = {
  key: string;
  title: string;
  text: ReactNode;
  /** Opens this page. */
  to?: string;
  /** Or does this when pressed (for example opens a form on the same page). */
  onClick?: () => void;
};

export function ActionCards({ cards, label }: { cards: ActionCard[]; label: string }) {
  return (
    <div className="action-grid" role="group" aria-label={label}>
      {cards.map((c) => {
        // Walkthrough 18 Nov, fix E1: each kind of action has its own symbol and colour, so the choices are told apart at a glance.
        const icon = ACTION_ICONS[c.key];
        const body = (
          <>
            {icon ? <span className="action-icon" aria-hidden="true">{icon}</span> : null}
            <strong className="action-title">{c.title}</strong>
            <span className="action-text">{c.text}</span>
          </>
        );
        return c.to
          ? <Link key={c.key} to={c.to} className="action-card" data-kind={c.key}>{body}</Link>
          : <button key={c.key} type="button" className="action-card" data-kind={c.key} onClick={c.onClick}>{body}</button>;
      })}
    </div>
  );
}
