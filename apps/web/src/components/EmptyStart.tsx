import { tr } from '../lib/i18n';
import { useLabChoice } from '../lib/labChoice';
import { Link } from '../lib/router';
import '../modules/sales/pagekit.css';

// New UI (plan of 23 Nov 2026; UX audit: "an empty screen says what to do next; it has one button"). What a person sees in a list that
// has nothing yet, in three versions being decided (Design Lab "Empty start"). Any list can use it once one is picked.
//   A  Numbered steps (Dynamics "Get started"): up to three short steps as rows, each with one button; the first is the main one.
//   B  One sentence, one button.
//   C  Show the shape: faded example rows of what the list will look like, with the sentence and the button over them.
export type EmptyStep = { title: string; text: string; to: string; action: string };
export function EmptyStart({ title, sentence, steps, example }: { title: string; sentence: string; steps: EmptyStep[]; example: string[][] }) {
  const version = useLabChoice('empty', ['A', 'B', 'C'] as const, 'A');
  const main = steps[0];
  if (version === 'B') {
    return (
      <div className="es es-b">
        <h2>{title}</h2>
        <p>{sentence}</p>
        {main && <Link to={main.to} className="pk-act pk-act-main es-btn">{main.action}</Link>}
        {steps[1] && <Link to={steps[1].to} className="pk-link es-alt">{steps[1].action}</Link>}
      </div>
    );
  }
  if (version === 'C') {
    return (
      <div className="es es-c">
        <table className="pk-table es-ghost" aria-hidden="true">
          <tbody>{example.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className={j === row.length - 1 ? 'pk-num' : undefined}>{cell}</td>)}</tr>)}</tbody>
        </table>
        <div className="es-over">
          <h2>{title}</h2>
          <p>{sentence}</p>
          {main && <Link to={main.to} className="pk-act pk-act-main es-btn">{main.action}</Link>}
        </div>
      </div>
    );
  }
  return (
    <div className="es es-a">
      <h2>{title}</h2>
      <p>{sentence}</p>
      <ol className="es-steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="es-n" aria-hidden="true">{i + 1}</span>
            <span className="es-t"><strong>{s.title}</strong><span>{s.text}</span></span>
            <Link to={s.to} className={i === 0 ? 'pk-act pk-act-main' : 'pk-act es-sec'}>{s.action}</Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Dev-only page that shows the empty start of Sales orders, so the versions can be compared (the demo always has orders). */
export function EmptyStartPreview() {
  return (
    <section className="page pk pk-wide">
      <div className="pk-head"><h1>{tr('Sales orders')}</h1></div>
      <EmptyStart
        title={tr('No sales orders yet')}
        sentence={tr('A sales order says what a customer buys. The warehouse sends the goods after a manager approves.')}
        steps={[
          { title: tr('Add your first customer'), text: tr('Name and phone are enough.'), to: '/sales/customers', action: tr('Add a customer') },
          { title: tr('Create the order'), text: tr('Pick the customer and the items; prices fill in.'), to: '/sales/orders/new', action: tr('New sales order') },
          { title: tr('Or bring in your customers'), text: tr('From a CSV or Excel file.'), to: '/settings/import', action: tr('Import from a file') },
        ]}
        example={[['SO-0003', 'Nile Pharmacies', 'New order', 'EGP 4,200.00'], ['SO-0002', 'Cairo Retail', 'Waiting for approval', 'EGP 1,820.00'], ['SO-0001', 'Delta Stores', 'Delivered', 'EGP 960.00']]}
      />
    </section>
  );
}
