import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/Loading';
import { ROLES, hasPermission, type Invitation, type InviteResult, type Member, type Role } from '@erp/shared';
import { ListView, type Column } from '../../../components/views/ListView';
import { api } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';

import { tr, trf } from '../../../lib/i18n';
import { ConfirmButton } from '../../../components/FormToggle';

// Shown words for the stored role and status codes ("member" was printed as is, in English, lower case).
const ROLE_NAME: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };
const STATUS_NAME: Record<string, string> = { active: 'Active', invited: 'Invited', disabled: 'Disabled' };
const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including managing owners',
  admin: 'Everything except managing owners',
  member: 'Use the apps; no settings or user changes',
  viewer: 'Read only',
};

export function InviteLinkBox({ email, link, onClose }: { email: string; link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="notice stack">
      <strong>{tr('Send this link to')} {email}</strong>
      <p className="muted small">
        {tr('It lets them set a password and sign in. It works once and expires; you can make a new one from the list. Treat it like a password: send it only to them.')}
      </p>
      <div className="copy-row">
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label={tr('Invite link')} />
        <Button
          type="button"
          onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}
        >
          {copied ? tr('Copied') : tr('Copy')}
        </Button>
      </div>
      <Button variant="outline" type="button" onClick={onClose}>
        {tr('Done')}
      </Button>
    </div>
  );
}

function InviteForm({ canInviteOwner, onInvited }: { canInviteOwner: boolean; onInvited: (r: InviteResult) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<InviteResult>('/v1/core/members', { method: 'POST', body: JSON.stringify({ email, name, role }) });
      setEmail('');
      setName('');
      onInvited(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card stack" onSubmit={submit}>
      <strong>{tr('Invite someone')}</strong>
      <div className="form-row">
        <label>
          {tr('Full name')}
          <input required minLength={2} maxLength={120} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {tr('Email')}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {tr('Role')}
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.filter((r) => r !== 'owner' || canInviteOwner).map((r) => (
              <option key={r} value={r}>
                {tr(ROLE_NAME[r])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint muted small">{tr(ROLE_HELP[role])}</p>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? tr('Inviting…') : tr('Invite')}
        </Button>
      </div>
    </form>
  );
}

export function UsersSettings() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'core.users.manage');
  const isOwner = session.role === 'owner';
  const members = useLoad(() => api<Member[]>('/v1/core/members'));
  const invitations = useLoad(() => (canManage ? api<Invitation[]>('/v1/core/members/invitations') : Promise.resolve([] as Invitation[])));
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ email: string; link: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(member: Member, run: () => Promise<void>) {
    setBusyId(member.id);
    setError(null);
    setNotice(null);
    try {
      await run();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function replace(updated: Member) {
    members.setData((members.data ?? []).map((m) => (m.id === updated.id ? updated : m)));
  }

  const [pendingRole, setPendingRole] = useState<{ m: Member; role: Role } | null>(null);
  const changeRole = (m: Member, role: Role) =>
    act(m, async () => replace(await api<Member>(`/v1/core/members/${m.id}`, { method: 'PATCH', body: JSON.stringify({ role }) })));

  const toggle = (m: Member) =>
    act(m, async () => {
      // Disabling is confirmed in place by ConfirmButton (no browser pop-up); enabling needs no question.
      const action = m.status === 'disabled' ? 'enable' : 'disable';
      replace(await api<Member>(`/v1/core/members/${m.id}/${action}`, { method: 'POST' }));
    });

  const newLink = (m: Member) =>
    act(m, async () => {
      const r = await api<{ inviteLink: string }>(`/v1/core/members/${m.id}/invite-link`, { method: 'POST' });
      setLink({ email: m.email, link: r.inviteLink });
    });

  async function withdraw(inv: Invitation) {
    setBusyId(inv.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/core/members/invitations/${inv.id}`, { method: 'DELETE' });
      invitations.setData((invitations.data ?? []).filter((i) => i.id !== inv.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Member>[] = [
    {
      key: 'email',
      label: tr('User'),
      value: (m) => m.name ?? m.email,
      render: (m) => (
        <div>
          <div>{m.name ?? m.email}</div>
          {m.name && <div className="muted small">{m.email}</div>}
          {m.userId === session.userId && <span className="badge">{tr('You')}</span>}
        </div>
      ),
    },
    {
      key: 'role',
      label: tr('Role'),
      value: (m) => m.role,
      render: (m) => {
        const locked = !canManage || m.userId === session.userId || (!isOwner && m.role === 'owner');
        if (locked) return <span>{tr(ROLE_NAME[m.role])}</span>;
        // A role change grants or removes powers at once, so it is confirmed first (UX audit: it applied on the spot).
        if (pendingRole?.m.id === m.id) {
          return (
            <div className="confirm-row" role="group">
              <span>{trf('Make {email} {role}?', { email: m.email, role: tr(ROLE_NAME[pendingRole.role]) })}</span>
              <Button size="sm" disabled={busyId === m.id} onClick={() => { const p = pendingRole; setPendingRole(null); changeRole(p.m, p.role); }}>{tr('Yes, change')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingRole(null)}>{tr('Cancel')}</Button>
            </div>
          );
        }
        return (
          <select
            value={m.role}
            disabled={busyId === m.id}
            onChange={(e) => setPendingRole({ m, role: e.target.value as Role })}
            aria-label={trf('Role for {email}', { email: m.email })}
          >
            {ROLES.filter((r) => r !== 'owner' || isOwner).map((r) => (
              <option key={r} value={r}>
                {tr(ROLE_NAME[r])}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: 'status',
      label: tr('Status'),
      value: (m) => m.status,
      render: (m) => <span className={`status status-${m.status}`}>{tr(STATUS_NAME[m.status] ?? m.status)}</span>,
    },
    { key: 'joined', label: tr('Added'), value: (m) => m.joinedAt, render: (m) => formatDate(m.joinedAt, session.org) },
    {
      key: 'last',
      label: tr('Last sign-in'),
      value: (m) => m.lastSignInAt,
      render: (m) => formatDate(m.lastSignInAt, session.org) || <span className="muted">{tr('Never')}</span>,
    },
  ];

  return (
    <section className="page">
      <h1>{tr('Users')}</h1>
      <p className="muted">{trf('Users of {org} and their roles.', { org: session.org?.name ?? '' })}</p>

      {link && <InviteLinkBox email={link.email} link={link.link} onClose={() => setLink(null)} />}
      {inviting && !link && (
        <InviteForm
          canInviteOwner={isOwner}
          onInvited={(r) => {
            setInviting(false);
            if (r.kind === 'added') {
              members.setData([...(members.data ?? []), r.member]);
              setLink({ email: r.member.email, link: r.inviteLink });
            } else {
              const others = (invitations.data ?? []).filter((i) => i.id !== r.invitation.id);
              invitations.setData([...others, r.invitation]);
              setNotice(trf('{email} has been invited. They will see the invitation when they sign in and join once they accept it.', { email: r.invitation.email }));
            }
          }}
        />
      )}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {members.error && <p className="error">{members.error}</p>}

      {canManage && (invitations.data?.length ?? 0) > 0 && (
        <div className="form-card stack">
          <strong>{tr('Pending invitations')}</strong>
          {invitations.data?.map((i) => (
            <div key={i.id} className="copy-row">
              <span>
                {i.email} <span className="muted small capitalize">({i.role})</span>
              </span>
              {(isOwner || i.role !== 'owner') && (
                <button className="link-btn" disabled={busyId === i.id} onClick={() => withdraw(i)}>
                  {tr('Withdraw')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {members.data ? (
        <ListView
          title={tr('Users')}
          rows={members.data}
          columns={columns}
          rowKey={(m) => m.id}
          toolbar={
            canManage && !inviting ? (
              <Button type="submit" onClick={() => setInviting(true)}>{tr('Invite user')}</Button>
            ) : canManage ? (
              <Button variant="outline" type="submit" onClick={() => setInviting(false)}>
                {tr('Cancel invite')}
              </Button>
            ) : null
          }
          actions={
            canManage
              ? (m) =>
                  m.userId === session.userId || (!isOwner && m.role === 'owner') ? null : (
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      {m.status === 'invited' && (
                        <Button variant="ghost" size="sm" disabled={busyId === m.id} onClick={() => newLink(m)}>
                          {tr('New invite link')}
                        </Button>
                      )}
                      {m.status === 'disabled'
                        ? <Button variant="outline" size="sm" disabled={busyId === m.id} onClick={() => toggle(m)}>{tr('Enable')}</Button>
                        : <ConfirmButton size="sm" label={tr('Disable')} confirmLabel={tr('Yes, disable')} question={trf('Disable {email}? They will lose access to {org}.', { email: m.name ?? m.email, org: session.org?.name ?? '' })} disabled={busyId === m.id} onConfirm={() => toggle(m)} />}
                    </span>
                  )
              : undefined
          }
        />
      ) : (
        !members.error && <Loading />
      )}
    </section>
  );
}
