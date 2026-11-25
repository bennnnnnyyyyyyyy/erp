import { useState } from 'react';
import { SCHEDULE_PERIODS, type ReportSchedule, type SavedReport, type ScheduleFrequency, type SchedulePeriod, type ScheduleRecipient } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { ConfirmButton, FormToggle } from '../../components/FormToggle';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';

// Scheduled reports (Reports & Insights step 6, sql/112). A saved company report is sent daily, weekly or monthly, at an hour in the
// company's time zone, to company members who may see its data. The database checks every recipient and sends them in the
// five-minute job: one message each with the totals and the first 5 rows; the message opens the report. Owners and admins.

type Team = { id: string; name: string };
type Person = { userId: string; name: string };

const FREQUENCY_LABEL: Record<ScheduleFrequency, string> = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };
const PERIOD_LABEL: Record<SchedulePeriod, string> = {
  yesterday: 'Yesterday',
  last_7_days: 'The last 7 days',
  last_week: 'Last week (Monday to Sunday)',
  this_month: 'This month so far',
  last_month: 'Last month',
};
/** ISO weekdays, 1 = Monday. */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ROLE_LABEL: Record<string, string> = { owner: 'All owners', admin: 'All admins', member: 'All members', viewer: 'All viewers' };
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

const EMPTY = { reportId: '', frequency: 'weekly' as ScheduleFrequency, weekday: '1', monthDay: '1', sendHour: '8', period: 'last_week', to: [] as string[], pick: '' };

/** The report a schedule starts from when opened from a report ("Send on a schedule"): ?report=<id>. */
function reportFromAddress(): string {
  const id = new URLSearchParams(window.location.search).get('report') ?? '';
  return /^[0-9a-f-]{36}$/i.test(id) ? id : '';
}

export function ReportSchedulesPage() {
  const session = useSession();
  const schedules = useLoad(() => api<ReportSchedule[]>('/v1/reports/schedules'));
  const reports = useLoad(() => api<SavedReport[]>('/v1/reports/saved'));
  // Teams belong to the alerts app; with it switched off a schedule goes to roles and people only.
  const teams = useLoad(() => api<Team[]>('/v1/alerts/teams').catch(() => [] as Team[]));
  const people = useLoad(() => api<Person[]>('/v1/core/people'));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => ({ ...EMPTY, reportId: reportFromAddress() }));
  const [open, setOpen] = useState(() => f.reportId !== '');

  async function run(work: () => Promise<string>, after: () => void) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await work() });
      after();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!schedules.data || !reports.data || !teams.data || !people.data)
    return (
      <section className="page">
        <Loading error={schedules.error ?? reports.error ?? people.error} />
      </section>
    );

  const companyReports = reports.data.filter((r) => r.visibility === 'company');
  const person = (id?: string) => people.data?.find((p) => p.userId === id)?.name ?? tr('Someone');
  const recipientLabel = (r: ScheduleRecipient) =>
    r.type === 'team' ? trf('Team: {name}', { name: teams.data?.find((t) => t.id === r.id)?.name ?? '?' }) : r.type === 'role' ? tr(ROLE_LABEL[r.role] ?? r.role) : person(r.id);
  const recipientOptions = [
    ...teams.data.map((t) => ({ value: `team:${t.id}`, label: trf('Team: {name}', { name: t.name }) })),
    ...Object.entries(ROLE_LABEL).map(([role, label]) => ({ value: `role:${role}`, label: tr(label) })),
    ...people.data.map((p) => ({ value: `user:${p.userId}`, label: p.name })),
  ];
  const parse = (to: string): ScheduleRecipient => {
    const [type, id] = to.split(':') as [string, string];
    return type === 'role' ? { type: 'role', role: id as 'owner' } : { type: type as 'team' | 'user', id };
  };
  const whenText = (s: Pick<ReportSchedule, 'frequency' | 'weekday' | 'monthDay' | 'sendHour'>) => {
    const at = hourLabel(s.sendHour);
    if (s.frequency === 'weekly') return trf('Every {day} at {time}', { day: tr(WEEKDAYS[(s.weekday ?? 1) - 1] ?? 'Monday'), time: at });
    if (s.frequency === 'monthly') return trf('Every month on day {n} at {time}', { n: s.monthDay ?? 1, time: at });
    return trf('Every day at {time}', { time: at });
  };

  const save = () =>
    run(
      async () => {
        await api('/v1/reports/schedules', {
          method: 'POST',
          body: JSON.stringify({
            reportId: f.reportId,
            frequency: f.frequency,
            weekday: Number(f.weekday),
            monthDay: Number(f.monthDay),
            sendHour: Number(f.sendHour),
            period: f.period || null,
            recipients: f.to.map(parse),
          }),
        });
        return trf('"{name}" will be sent on its schedule.', { name: companyReports.find((r) => r.id === f.reportId)?.name ?? '' });
      },
      () => {
        setF(EMPTY);
        schedules.reload();
      },
    );

  return (
    <section className="page wide">
      <h1>{tr('Scheduled reports')}</h1>
      <p className="muted">
        {tr('Send a company report to people on a schedule. Each person gets the totals and the first 5 rows, with a link to the full report. Only people who may see the report’s data get it.')}
      </p>
      {msg && <p className={msg.ok ? 'notice' : 'error notice'}>{msg.text}</p>}

      <FormToggle label={tr('Add a schedule')} open={open} onOpenChange={setOpen}>
        {companyReports.length === 0 ? (
          <p className="muted">
            {tr('Save a report for the company first: only company reports can be sent on a schedule.')} <Link to="/reports/new">{tr('New report')}</Link>
          </p>
        ) : (
          <>
            <div className="form-row">
              <label>
                {tr('Report')}
                <select value={f.reportId} onChange={(e) => setF({ ...f, reportId: e.target.value })}>
                  <option value="">{tr('Choose…')}</option>
                  {companyReports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr('How often')}
                <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as ScheduleFrequency })}>
                  {(Object.keys(FREQUENCY_LABEL) as ScheduleFrequency[]).map((k) => (
                    <option key={k} value={k}>
                      {tr(FREQUENCY_LABEL[k])}
                    </option>
                  ))}
                </select>
              </label>
              {f.frequency === 'weekly' && (
                <label>
                  {tr('Day')}
                  <select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={String(i + 1)}>
                        {tr(d)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {f.frequency === 'monthly' && (
                <label>
                  {tr('Day of the month')}
                  <select value={f.monthDay} onChange={(e) => setF({ ...f, monthDay: e.target.value })}>
                    {MONTH_DAYS.map((d) => (
                      <option key={d} value={String(d)}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {tr('At')}
                <select value={f.sendHour} onChange={(e) => setF({ ...f, sendHour: e.target.value })}>
                  {HOURS.map((h) => (
                    <option key={h} value={String(h)}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr('Covering')}
                <select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
                  {SCHEDULE_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {tr(PERIOD_LABEL[p])}
                    </option>
                  ))}
                  <option value="">{tr('No period (stock and money owed now)')}</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                {tr('Send to')}
                <select value={f.pick} onChange={(e) => setF({ ...f, pick: '', to: e.target.value && !f.to.includes(e.target.value) ? [...f.to, e.target.value] : f.to })}>
                  <option value="">{tr('Choose…')}</option>
                  {recipientOptions
                    .filter((o) => !f.to.includes(o.value))
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {f.to.length > 0 && (
              <p className="small">
                {f.to.map((v) => (
                  <Button key={v} variant="outline" size="sm" onClick={() => setF({ ...f, to: f.to.filter((x) => x !== v) })} aria-label={trf('Remove {name}', { name: recipientLabel(parse(v)) })}>
                    {recipientLabel(parse(v))} ✕
                  </Button>
                ))}
              </p>
            )}
            <p className="muted small">{tr('The hour is in your company’s time zone. A report about stock on hand or money owed has no period: choose “No period”.')}</p>
            <Button disabled={busy || !f.reportId || f.to.length === 0} onClick={save}>
              {tr('Save the schedule')}
            </Button>
          </>
        )}
      </FormToggle>

      {schedules.data.length === 0 ? (
        <p className="muted">{tr('No scheduled reports yet.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{tr('Report')}</th>
                <th scope="col">{tr('When')}</th>
                <th scope="col">{tr('Covering')}</th>
                <th scope="col">{tr('Send to')}</th>
                <th scope="col">{tr('Next send')}</th>
                <th scope="col">{tr('Last sent')}</th>
                <th scope="col">{tr('State')}</th>
                <th scope="col">
                  <span className="sr-only">{tr('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {schedules.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.reportDeleted ? s.reportName : <Link to={`/reports/${s.reportId}`}>{s.reportName}</Link>}</td>
                  <td>{whenText(s)}</td>
                  <td>{s.period ? tr(PERIOD_LABEL[s.period]) : tr('No period')}</td>
                  <td>{s.recipients.map(recipientLabel).join(', ')}</td>
                  <td>{s.enabled && s.nextRunAt ? formatDateTime(s.nextRunAt, session.org) : '—'}</td>
                  <td>{s.lastSentAt ? formatDateTime(s.lastSentAt, session.org) : '—'}</td>
                  <td>
                    <Pill status={s.enabled ? 'active' : 'paused'} label={s.enabled ? tr('On') : tr('Paused')} />
                  </td>
                  <td className="actions">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || s.reportDeleted}
                      onClick={() =>
                        run(
                          async () => {
                            await api(`/v1/reports/schedules/${s.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !s.enabled }) });
                            return s.enabled ? trf('"{name}" paused.', { name: s.reportName }) : trf('"{name}" will be sent again.', { name: s.reportName });
                          },
                          schedules.reload,
                        )
                      }
                    >
                      {s.enabled ? tr('Pause') : tr('Resume')}
                    </Button>{' '}
                    <ConfirmButton
                      size="sm"
                      label={tr('Delete')}
                      confirmLabel={tr('Delete')}
                      question={trf('Stop sending "{name}" and delete this schedule?', { name: s.reportName })}
                      disabled={busy}
                      onConfirm={() =>
                        run(
                          async () => {
                            await api(`/v1/reports/schedules/${s.id}`, { method: 'DELETE' });
                            return trf('The schedule for "{name}" was deleted.', { name: s.reportName });
                          },
                          schedules.reload,
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
