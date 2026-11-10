import { useState } from 'react';
import type { ReportLink, ReportLinkCreated, ReportLinkKind } from '@erp/shared';
import { REPORT_LINK_KINDS } from '@erp/shared';
import { ConfirmButton } from '../../../components/FormToggle';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { tr, trf } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';
import { Notice, useNotice } from '../../accounting/common';

// Settings > Integrations > Links for Google Sheets (sql/070, documentation/planning/2026-11-09-google-sheets-options.md option C).
// A private link per report; in Google Sheets =IMPORTDATA("link") keeps the sheet current. The link is a key: the address is shown once
// (only its hash is stored) and anyone who has it can read that report until it is revoked or expires.

const REPORT_NAME: Record<ReportLinkKind, string> = {
  stock_on_hand: 'Stock on hand',
  open_invoices: 'Open invoices',
  sales_by_month: 'Sales by month',
};

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <input readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} dir="ltr" />
      <Button type="button" onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true))}>
        {copied ? tr('Copied') : tr('Copy')}
      </Button>
    </div>
  );
}

export function ReportLinks({ canManage }: { canManage: boolean }) {
  const session = useSession();
  const links = useLoad(() => api<ReportLink[]>('/v1/core/report-links'));
  const { message, busy, run } = useNotice();
  const [report, setReport] = useState<ReportLinkKind>('stock_on_hand');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('');
  const [created, setCreated] = useState<ReportLinkCreated | null>(null);

  const create = () =>
    run(
      async () => {
        const made = await api<ReportLinkCreated>('/v1/core/report-links', {
          method: 'POST',
          body: JSON.stringify({ report, label: label.trim() || null, expiresDays: days.trim() ? Number(days) : null }),
        });
        setCreated(made);
        setLabel('');
        setDays('');
        return tr('Link created. Copy it now: it cannot be shown again.');
      },
      links.reload,
    );

  return (
    <div className="form-card stack intg-detail">
      <h2>{tr('Links for Google Sheets')}</h2>
      <p className="muted small">
        {tr('A private link lets a Google Sheet read one report and refresh by itself. Paste the formula into a cell. The reports hold no phone numbers, emails or addresses.')}
      </p>
      <p className="notice small">{tr('Anyone who has the link can read that report until you revoke it. Share it only with people who should see these numbers.')}</p>
      <Notice message={message} />

      {canManage ? (
        <div className="form-row">
          <label>
            {tr('Report')}
            <select value={report} onChange={(e) => setReport(e.target.value as ReportLinkKind)}>
              {REPORT_LINK_KINDS.map((k) => (
                <option key={k} value={k}>{tr(REPORT_NAME[k])}</option>
              ))}
            </select>
          </label>
          <label>
            {tr('Label (optional)')}
            <input value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            {tr('Expires after (days, optional)')}
            <input type="number" min={1} max={3650} step={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <Button disabled={busy} onClick={create}>{tr('Create link')}</Button>
        </div>
      ) : null}

      {created ? (
        <div className="notice stack">
          <strong>{tr('Your new link')}</strong>
          <p className="muted small">{tr('It is shown only once. In Google Sheets, paste this formula into a cell:')}</p>
          <CopyField label={tr('Google Sheets formula')} value={created.formula} />
          <p className="muted small">{tr('Or the plain link:')}</p>
          <CopyField label={tr('Link')} value={created.url} />
          <Button variant="outline" type="button" onClick={() => setCreated(null)}>{tr('Done')}</Button>
        </div>
      ) : null}

      {!links.data ? <Loading error={links.error} rows={2} /> : links.data.length === 0 ? (
        <p className="muted small">{tr('No links yet.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{tr('Report')}</th>
                <th scope="col">{tr('Label')}</th>
                <th scope="col">{tr('Created')}</th>
                <th scope="col">{tr('Last read')}</th>
                <th scope="col" className="right">{tr('Reads')}</th>
                <th scope="col">{tr('Expires')}</th>
                <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {links.data.map((l) => {
                const expired = l.expiresAt !== null && new Date(l.expiresAt).getTime() <= Date.now();
                return (
                  <tr key={l.id}>
                    <td>{tr(REPORT_NAME[l.report])}</td>
                    <td>{l.label ?? ''}</td>
                    <td>{formatDateTime(l.createdAt, session.org)}</td>
                    <td>{l.lastReadAt ? formatDateTime(l.lastReadAt, session.org) : tr('Never')}</td>
                    <td className="right">{l.readCount}</td>
                    <td>{l.expiresAt ? formatDateTime(l.expiresAt, session.org) : tr('Never')}{expired && !l.revokedAt ? ` (${tr('expired')})` : ''}</td>
                    <td>
                      {l.revokedAt ? (
                        <span className="muted small">{trf('Revoked {date}', { date: formatDateTime(l.revokedAt, session.org) })}</span>
                      ) : canManage ? (
                        <ConfirmButton
                          size="sm"
                          label={tr('Revoke')}
                          confirmLabel={tr('Yes, revoke')}
                          question={tr('Revoke this link? Sheets using it stop updating.')}
                          disabled={busy}
                          onConfirm={() => run(async () => {
                            await api(`/v1/core/report-links/${l.id}/revoke`, { method: 'POST' });
                            return tr('Link revoked.');
                          }, links.reload)}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
