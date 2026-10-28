import { useState, type FormEvent } from 'react';
import { ROLES, hasPermission, type InviteResult, type Member, type Role } from '@ggo/shared';
import { ListView, type Column } from '../../../components/views/ListView';
import { api } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including managing owners',
  admin: 'Everything except managing owners',
  member: 'Use the apps; no settings or user changes',
  viewer: 'Read only',
};

function InviteLinkBox({ email, link, onClose }: { email: string; link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="notice stack">
      <strong>Send this link to {email}</strong>
      <p className="muted small">
        It lets them set a password and sign in. It works once and expires; you can make a new one from the list. Treat
        it like a password: send it only to them.
      </p>
      <div className="copy-row">
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <button type="button" className="secondary" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

function InviteForm({ canInviteOwner, onInvited }: { canInviteOwner: boolean; onInvited: (r: InviteResult) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<InviteResult>('/v1/core/members', { method: 'POST', body: JSON.stringify({ email, role }) });
      setEmail('');
      onInvited(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card stack" onSubmit={submit}>
      <strong>Invite someone</strong>
      <div className="form-row">
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.filter((r) => r !== 'owner' || canInviteOwner).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint muted small">{ROLE_HELP[role]}</p>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Inviting…' : 'Invite'}
        </button>
      </div>
    </form>
  );
}

export function UsersSettings() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'core.users.manage');
  const isOwner = session.role === 'owner';
  const members = useLoad(() => api<Member[]>('/v1/core/members'));
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

  const changeRole = (m: Member, role: Role) =>
    act(m, async () => replace(await api<Member>(`/v1/core/members/${m.id}`, { method: 'PATCH', body: JSON.stringify({ role }) })));

  const toggle = (m: Member) =>
    act(m, async () => {
      const action = m.status === 'disabled' ? 'enable' : 'disable';
      if (action === 'disable' && !window.confirm(`Disable ${m.email}? They will lose access to ${session.org?.name}.`)) return;
      replace(await api<Member>(`/v1/core/members/${m.id}/${action}`, { method: 'POST' }));
    });

  const newLink = (m: Member) =>
    act(m, async () => {
      const r = await api<{ inviteLink: string }>(`/v1/core/members/${m.id}/invite-link`, { method: 'POST' });
      setLink({ email: m.email, link: r.inviteLink });
    });

  const columns: Column<Member>[] = [
    {
      key: 'email',
      label: 'User',
      value: (m) => m.name ?? m.email,
      render: (m) => (
        <div>
          <div>{m.name ?? m.email}</div>
          {m.name && <div className="muted small">{m.email}</div>}
          {m.userId === session.userId && <span className="badge">You</span>}
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      value: (m) => m.role,
      render: (m) => {
        const locked = !canManage || m.userId === session.userId || (!isOwner && m.role === 'owner');
        if (locked) return <span className="capitalize">{m.role}</span>;
        return (
          <select
            value={m.role}
            disabled={busyId === m.id}
            onChange={(e) => changeRole(m, e.target.value as Role)}
            aria-label={`Role for ${m.email}`}
          >
            {ROLES.filter((r) => r !== 'owner' || isOwner).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      value: (m) => m.status,
      render: (m) => <span className={`status status-${m.status}`}>{m.status}</span>,
    },
    { key: 'joined', label: 'Added', value: (m) => m.joinedAt, render: (m) => formatDate(m.joinedAt, session.org) },
    {
      key: 'last',
      label: 'Last sign-in',
      value: (m) => m.lastSignInAt,
      render: (m) => formatDate(m.lastSignInAt, session.org) || <span className="muted">Never</span>,
    },
  ];

  return (
    <section className="page">
      <h1>Users</h1>
      <p className="muted">Who can sign in to {session.org?.name}, and what they can do.</p>

      {link && <InviteLinkBox email={link.email} link={link.link} onClose={() => setLink(null)} />}
      {inviting && !link && (
        <InviteForm
          canInviteOwner={isOwner}
          onInvited={(r) => {
            members.setData([...(members.data ?? []), r.member]);
            setInviting(false);
            if (r.inviteLink) setLink({ email: r.member.email, link: r.inviteLink });
            else setNotice(`${r.member.email} already had an account and has been added. They can sign in now.`);
          }}
        />
      )}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {members.error && <p className="error">{members.error}</p>}

      {members.data ? (
        <ListView
          title="Users"
          rows={members.data}
          columns={columns}
          rowKey={(m) => m.id}
          toolbar={
            canManage && !inviting ? (
              <button onClick={() => setInviting(true)}>Invite user</button>
            ) : canManage ? (
              <button className="secondary" onClick={() => setInviting(false)}>
                Cancel invite
              </button>
            ) : null
          }
          actions={
            canManage
              ? (m) =>
                  m.userId === session.userId || (!isOwner && m.role === 'owner') ? null : (
                    <>
                      {m.status === 'invited' && (
                        <button className="link-btn" disabled={busyId === m.id} onClick={() => newLink(m)}>
                          New invite link
                        </button>
                      )}
                      <button className="link-btn" disabled={busyId === m.id} onClick={() => toggle(m)}>
                        {m.status === 'disabled' ? 'Enable' : 'Disable'}
                      </button>
                    </>
                  )
              : undefined
          }
        />
      ) : (
        !members.error && <p className="muted">Loading…</p>
      )}
    </section>
  );
}
