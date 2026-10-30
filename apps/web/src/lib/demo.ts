import { handleInventory, ACTOR_NAMES } from './demoInventory';
import { handleTrade } from './demoTrade';
import { MODULES, type AuditEntry, type InviteResult, type Member, type ModuleStatus, type OrgSettings, type Role } from '@erp/shared';

// Demo mode (`npm run dev:demo -w apps/web`): the web app runs on sample data held in memory, with no
// API, no database and no sign-in, so the screens can be looked at and clicked through. Nothing here
// ships in a normal build: `VITE_DEMO_MODE` is only set by the `demo` Vite mode.
export const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';

export class DemoError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const now = Date.now();
const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

const org: OrgSettings = {
  id: 'demo-org',
  name: 'Demo Trading Co.',
  slug: 'demo-trading',
  defaultCurrency: 'EGP',
  timezone: 'Africa/Cairo',
  dateFormat: 'DD/MM/YYYY',
};

const members: Member[] = [
  { id: 'm1', userId: 'u1', email: 'owner@demo.example', name: 'Layla Hassan', role: 'owner', status: 'active', joinedAt: ago(900), lastSignInAt: ago(1) },
  { id: 'm2', userId: 'u2', email: 'karim.admin@demo.example', name: 'Karim Adel', role: 'admin', status: 'active', joinedAt: ago(700), lastSignInAt: ago(5) },
  { id: 'm3', userId: 'u3', email: 'mona.storekeeper@demo.example', name: 'Mona Saeed', role: 'member', status: 'active', joinedAt: ago(300), lastSignInAt: ago(26) },
  { id: 'm4', userId: 'u4', email: 'auditor@demo.example', name: null, role: 'viewer', status: 'invited', joinedAt: ago(30), lastSignInAt: null },
  { id: 'm5', userId: 'u5', email: 'former.employee@demo.example', name: 'Omar Fathy', role: 'member', status: 'disabled', joinedAt: ago(1200), lastSignInAt: ago(400) },
];

// Purchasing and Sales exist only in the demo, to show where the product grows; they are not in the real module manifest yet.
const DEMO_MODULES: Omit<ModuleStatus, 'enabled'>[] = [
  { key: 'purchasing', name: 'Purchasing', description: 'Suppliers, purchase orders and receiving goods into stock (demo).', suite: 'Sales & Purchasing', core: false },
  { key: 'sales', name: 'Sales', description: 'Customers and sales orders that raise stock requests (demo).', suite: 'Sales & Purchasing', core: false },
];
const enabledModules = new Set<string>([...MODULES.filter((m) => m.core).map((m) => m.key), 'inventory', 'purchasing', 'sales']);

let auditId = 0;
const audit: (AuditEntry & { before: unknown; after: unknown })[] = [];
function log(hoursAgo: number, actor: string, action: string, entityType: string, entityId: string | null, summary: string) {
  audit.unshift({ id: ++auditId, occurred_at: ago(hoursAgo), actor_user_id: actor, action, entity_type: entityType, entity_id: entityId, summary, before: null, after: null });
}
log(900, 'u1', 'organization.created', 'organization', org.id, 'Organization Demo Trading Co. created');
log(700, 'u1', 'member.invited', 'membership', 'm2', 'karim.admin@demo.example invited as admin');
log(300, 'u2', 'member.invited', 'membership', 'm3', 'mona.storekeeper@demo.example invited as member');
log(30, 'u2', 'member.invited', 'membership', 'm4', 'auditor@demo.example invited as viewer');
log(8, 'u1', 'organization.updated', 'organization', org.id, 'Organization settings changed: defaultCurrency, timezone');

/** The demo user acts as this member; the role is switched from the demo banner (see DemoApp.tsx). */
export const demoActor: { id: string; role: Role } = { id: 'u1', role: 'owner' };

function body<T>(init: RequestInit): T {
  return (init.body ? JSON.parse(String(init.body)) : {}) as T;
}

export async function demoApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, 120)); // so loading states are visible
  const method = (init.method ?? 'GET').toUpperCase();
  const [pathname] = path.split('?');
  const area0 = /^\/v1\/(inventory|purchasing|sales)(?:\/|$)/.exec(pathname ?? '')?.[1] as 'inventory' | 'purchasing' | 'sales' | undefined;
  if (area0) {
    const rest = (pathname ?? '').replace(/^\/v1\/[a-z]+\/?/, '').split('/').filter(Boolean);
    const actor = {
      id: demoActor.id,
      name: ACTOR_NAMES[demoActor.id] ?? demoActor.id,
      role: demoActor.role,
      log: (action: string, entityType: string, entityId: string, summary: string) => log(0, demoActor.id, action, entityType, entityId, summary),
    };
    const data = body<Record<string, unknown>>(init);
    const result = area0 === 'inventory' ? handleInventory(method, rest, data, actor) : handleTrade(area0, method, rest, data, actor);
    return structuredClone(result) as T;
  }
  const parts = (pathname ?? '').replace(/^\/v1\/core\/?/, '').split('/').filter(Boolean);
  const [area, id, action] = parts;
  const result = handle(method, area, id, action, init);
  return structuredClone(result) as T;
}

function handle(method: string, area: string | undefined, id: string | undefined, action: string | undefined, init: RequestInit): unknown {
  if (area === 'org') {
    if (method === 'PATCH') {
      const changes = body<Partial<OrgSettings>>(init);
      Object.assign(org, changes);
      log(0, demoActor.id, 'organization.updated', 'organization', org.id, `Organization settings changed: ${Object.keys(changes).join(', ')}`);
    }
    return org;
  }

  if (area === 'modules') {
    if (!id) {
      return [...MODULES, ...DEMO_MODULES].map<ModuleStatus>((m) => ({ key: m.key, name: m.name, description: m.description, suite: m.suite, core: m.core, enabled: enabledModules.has(m.key) }));
    }
    const mod = [...MODULES, ...DEMO_MODULES].find((m) => m.key === id);
    if (!mod) throw new DemoError(404, 'Unknown module', 'not_found');
    if (action === 'enable') enabledModules.add(id);
    else if (action === 'disable') enabledModules.delete(id);
    log(0, demoActor.id, `module.${action}d`, 'module', id, `${mod.name} switched ${action === 'enable' ? 'on' : 'off'}`);
    return { key: id, enabled: action === 'enable' };
  }

  if (area === 'audit') return audit;

  if (area === 'members') {
    if (method === 'GET' && !id) return members;
    if (method === 'POST' && !id) {
      const { email, role } = body<{ email: string; role: Role }>(init);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) throw new DemoError(400, 'Enter a valid email address', 'invalid_input');
      if (members.some((m) => m.email.toLowerCase() === email.toLowerCase())) throw new DemoError(409, 'That person is already a member', 'conflict');
      const member: Member = { id: `m${members.length + 1}`, userId: `u${members.length + 1}`, email, name: null, role, status: 'invited', joinedAt: new Date().toISOString(), lastSignInAt: null };
      members.push(member);
      log(0, demoActor.id, 'member.invited', 'membership', member.id, `${email} invited as ${role}`);
      const result: InviteResult = { kind: 'added', member, inviteLink: 'https://demo.invalid/accept-invite#demo' };
      return result;
    }
    if (id === 'invitations' && method === 'GET') return [];
    const member = members.find((m) => m.id === id);
    if (!member) throw new DemoError(404, 'Member not found', 'not_found');
    if (action === 'invite-link') return { inviteLink: 'https://demo.invalid/accept-invite#demo' };
    if (action === 'disable') {
      member.status = 'disabled';
      log(0, demoActor.id, 'member.disabled', 'membership', member.id, `${member.email} disabled`);
    } else if (action === 'enable') {
      member.status = member.lastSignInAt ? 'active' : 'invited';
      log(0, demoActor.id, 'member.enabled', 'membership', member.id, `${member.email} enabled`);
    } else if (method === 'PATCH') {
      const { role } = body<{ role: Role }>(init);
      log(0, demoActor.id, 'member.role_changed', 'membership', member.id, `${member.email}: ${member.role} to ${role}`);
      member.role = role;
    }
    return member;
  }

  throw new DemoError(404, 'Not available in demo mode', 'not_found');
}
