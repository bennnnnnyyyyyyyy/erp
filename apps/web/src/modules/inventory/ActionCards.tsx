import type { ReactNode } from 'react';
import { Link } from '../../lib/router';

// Big, plainly worded choices: a title, one line saying what it does, and where it goes (or what it does when pressed).
// Used by the Inventory overview ("What do you want to do?") and by the Receive goods and Count stock pages.

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
        const body = (<><strong className="action-title">{c.title}</strong><span className="action-text">{c.text}</span></>);
        return c.to
          ? <Link key={c.key} to={c.to} className="action-card">{body}</Link>
          : <button key={c.key} type="button" className="action-card" onClick={c.onClick}>{body}</button>;
      })}
    </div>
  );
}
