import { Fragment } from 'react';
import { parseRich } from '../modules/help/helpContent';

/** Renders text with **bold** markers (see helpContent.ts). Plain text in, safe React nodes out: no HTML is ever injected. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {parseRich(text).map((r, i) => (
        <Fragment key={i}>{r.bold ? <b>{r.text}</b> : r.text}</Fragment>
      ))}
    </>
  );
}
