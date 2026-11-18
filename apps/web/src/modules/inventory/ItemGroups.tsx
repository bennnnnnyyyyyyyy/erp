import { Fragment, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import { currentLanguage, tr, trf } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { Link } from '../../lib/router';
import { useSession } from '../../session';

/** Inventory → Settings and planning → Inventory settings (walkthrough 18 Nov, fix C2: the code rule was hard to find on Item groups). */
export function InventorySettingsPage() {
  const role = useSession().role;
  const canManage = !demoMode && (role === 'owner' || role === 'admin');
  const rule = useLoad(() => (demoMode ? Promise.resolve(null) : api<CodeRule>('/v1/inventory/item-code-rule')));
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section className="page">
      <h1>{tr('Inventory settings')}</h1>
      <p className="muted">{tr('How new items get their code. Codes never change once given, even if an item moves to another group.')}</p>
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {!rule.data ? (
        <Loading error={rule.error} />
      ) : canManage ? (
        <CodeRuleForm rule={rule.data} onSaved={() => { rule.reload(); setNotice(tr('Item code rule saved.')); }} />
      ) : (
        <p>{tr('Only an owner or admin can change the item code rule.')}</p>
      )}
      <p className="muted small"><Link to="/inventory/item-groups">{tr('Item groups')}</Link></p>
    </section>
  );
}

// Item groups and the item code rule (sql/095, documentation/plans/MASTER_DATA_PLAN.md slice A). Groups form a tree of any depth, each
// with a code; under the "group codes" rule a new item's code is its groups' codes and a number (10-03-007). Codes never change once
// given: renaming or re-coding a group, or moving an item to another group, leaves existing codes as they are.

export type ItemGroup = { id: string; parentId: string | null; code: string; name: string; nameAr: string; active: boolean };
export type CodeRule = { rule: 'typed' | 'prefix' | 'group'; separator: string; digits: number; next: string | null };

/** The company's groups (none in the sample-data build, which has no such route). */
export function useItemGroups() {
  return useLoad(() => (demoMode ? Promise.resolve([] as ItemGroup[]) : api<ItemGroup[]>('/v1/inventory/item-groups').catch(() => [] as ItemGroup[])));
}

/** Each live group with its full code (10-03) and depth, in tree order. */
export function flattenGroups(groups: ItemGroup[], separator = '-'): (ItemGroup & { fullCode: string; depth: number })[] {
  const out: (ItemGroup & { fullCode: string; depth: number })[] = [];
  const walk = (parentId: string | null, prefix: string, depth: number) => {
    for (const g of groups.filter((x) => x.parentId === parentId).sort((a, b) => a.code.localeCompare(b.code))) {
      const fullCode = prefix ? `${prefix}${separator}${g.code}` : g.code;
      out.push({ ...g, fullCode, depth });
      if (depth < 50) walk(g.id, fullCode, depth + 1);
    }
  };
  walk(null, '', 0);
  return out;
}

/** A group's name in the language in use. */
export const groupName = (g: ItemGroup, lang: string) => (lang === 'ar' && g.nameAr ? g.nameAr : g.name);

/** A select of live groups, indented by level. */
export function GroupSelect({ groups, value, onChange, separator, emptyLabel, activeOnly = true, exclude, leafOnly = false }: {
  groups: ItemGroup[]; value: string; onChange: (id: string) => void; separator?: string; emptyLabel: string; activeOnly?: boolean; exclude?: Set<string>;
  /** For items (Ben's walkthrough 18 Nov; the database enforces it, sql/098): only groups without sub-groups can be chosen. Each main
   *  group with sub-groups is a heading, its sub-groups listed under it; a main group without sub-groups is a choice of its own. */
  leafOnly?: boolean;
}) {
  const lang = currentLanguage();
  if (leafOnly) {
    const live = flattenGroups(groups, separator).filter((g) => !activeOnly || g.active);
    const hasChildren = new Set(live.filter((g) => g.parentId).map((g) => g.parentId as string));
    const label = (g: (typeof live)[number]) => `${g.fullCode} · ${groupName(g, lang)}`;
    const tops = live.filter((g) => !g.parentId);
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {tops.map((t) =>
          hasChildren.has(t.id) ? (
            <optgroup key={t.id} label={label(t)}>
              {[...descendants(live, t.id)]
                .map((id) => live.find((g) => g.id === id)!)
                .filter((g) => g.id !== t.id && !hasChildren.has(g.id))
                .map((g) => <option key={g.id} value={g.id}>{label(g)}</option>)}
            </optgroup>
          ) : (
            <option key={t.id} value={t.id}>{label(t)}</option>
          ),
        )}
      </select>
    );
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {flattenGroups(groups, separator)
        .filter((g) => (!activeOnly || g.active) && !exclude?.has(g.id))
        .map((g) => <option key={g.id} value={g.id}>{`${'  '.repeat(g.depth)}${g.fullCode} · ${groupName(g, lang)}`}</option>)}
    </select>
  );
}

const descendants = (groups: ItemGroup[], id: string): Set<string> => {
  const found = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) if (g.parentId && found.has(g.parentId) && !found.has(g.id)) { found.add(g.id); grew = true; }
  }
  return found;
};

type Draft = { id: string | null; parentId: string; code: string; name: string; nameAr: string; active: boolean };

export function ItemGroupsPage() {
  const lang = currentLanguage();
  const role = useSession().role;
  const canManage = !demoMode && (role === 'owner' || role === 'admin');
  const groups = useItemGroups();
  const rule = useLoad(() => (demoMode ? Promise.resolve(null) : api<CodeRule>('/v1/inventory/item-code-rule')));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (groups.loading || rule.loading) return <section className="page"><Loading /></section>;
  const list = groups.data ?? [];
  const separator = rule.data?.separator ?? '-';
  const rows = flattenGroups(list, separator);

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      setDraft(null);
      groups.reload();
      rule.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const body = { code: draft.code, name: draft.name, nameAr: draft.nameAr, active: draft.active };
    if (!draft.id) {
      await run(() => api('/v1/inventory/item-groups', { method: 'POST', body: JSON.stringify({ ...body, parentId: draft.parentId || null }) }), tr('Group added.'));
      return;
    }
    const before = list.find((g) => g.id === draft.id);
    const id = draft.id;
    await run(async () => {
      await api(`/v1/inventory/item-groups/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      if ((before?.parentId ?? '') !== draft.parentId)
        await api(`/v1/inventory/item-groups/${id}/parent`, { method: 'PUT', body: JSON.stringify({ parentId: draft.parentId || null }) });
    }, tr('Group saved. Items already coded keep their codes.'));
  }

  // Walkthrough 18 Nov, fix C1: the form opens under the row it belongs to (add a sub-group, edit), or at the top for a main group.
  const draftForm = draft ? (
      <form className="form-card stack" onSubmit={save} aria-label={draft.id ? tr('Edit group') : tr('Add group')}>
        <div className="form-row">
          <label>
            {tr('Under')}
            <GroupSelect groups={list} value={draft.parentId} separator={separator} emptyLabel={tr('Top level')} activeOnly={false}
              exclude={draft.id ? descendants(list, draft.id) : undefined} onChange={(parentId) => setDraft({ ...draft, parentId })} />
          </label>
          <label>
            {tr('Code')}
            <input required maxLength={10} pattern="[A-Za-z0-9]{1,10}" placeholder="10" value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
          </label>
        </div>
        <div className="form-row">
          <label>{tr('Name')}<input required maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>{tr('Name in Arabic (optional)')}<input dir="rtl" maxLength={120} value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} /></label>
        </div>
        {draft.id ? (
          <label className="option-switch">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            <span>{tr('New items can be added to this group')}</span>
          </label>
        ) : null}
        <p className="muted small">{tr('Letters and digits, up to 10. Changing a code or moving a group changes the codes of new items only.')}</p>
        <div className="form-actions">
          <Button type="submit">{draft.id ? tr('Save changes') : tr('Add group')}</Button>
          <Button type="button" variant="ghost" onClick={() => setDraft(null)}>{tr('Cancel')}</Button>
        </div>
      </form>
  ) : null;
  const formAfter = (g: { id: string }) => draft !== null && (draft.id === g.id || (draft.id === null && draft.parentId === g.id));

  return (
    <section className="page">
      <h1>{tr('Item groups')}</h1>
      <p className="muted">{tr('Groups and sub-groups organise your items, each with its own code. Under the group code rule a new item gets its groups’ codes and a number, for example 10-03-007.')}</p>
      {rule.data ? (
        <p className="muted small">
          {rule.data.rule === 'group'
            ? tr('Item codes: built from the groups, for example 10-03-007.')
            : rule.data.rule === 'prefix'
              ? tr('Item codes: a prefix and a number.')
              : tr('Item codes: typed by hand.')}{' '}
          <Link to="/inventory/settings">{tr('Change in Inventory settings')}</Link>
        </p>
      ) : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {canManage && !draft ? (
        <div className="form-actions">
          <Button type="button" onClick={() => setDraft({ id: null, parentId: '', code: '', name: '', nameAr: '', active: true })}>{tr('Add main group')}</Button>
        </div>
      ) : null}
      {draft && draft.id === null && draft.parentId === '' ? draftForm : null}
      {rows.length === 0 ? (
        <p className="muted">{tr('No item groups yet.')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{tr('Code')}</th>
              <th scope="col">{tr('Name')}</th>
              <th scope="col">{tr('Status')}</th>
              {canManage ? <th scope="col"><span className="sr-only">{tr('Actions')}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <Fragment key={g.id}>
              <tr>
                <td><code style={{ paddingInlineStart: `${g.depth * 1.25}rem` }}>{g.fullCode}</code></td>
                <td style={{ paddingInlineStart: `${g.depth * 1.25}rem` }}>{g.depth === 0 ? <strong>{groupName(g, lang)}</strong> : groupName(g, lang)}</td>
                <td>{g.active ? tr('Active') : tr('Closed to new items')}</td>
                {canManage ? (
                  <td className="actions">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ id: null, parentId: g.id, code: '', name: '', nameAr: '', active: true })}>{tr('Add sub-group')}</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ id: g.id, parentId: g.parentId ?? '', code: g.code, name: g.name, nameAr: g.nameAr, active: g.active })}>{tr('Edit')}</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void run(() => api(`/v1/inventory/item-groups/${g.id}`, { method: 'DELETE' }), trf('Group {code} removed.', { code: g.fullCode }))}>{tr('Remove')}</Button>
                  </td>
                ) : null}
              </tr>
              {formAfter(g) ? <tr><td colSpan={canManage ? 4 : 3}>{draftForm}</td></tr> : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Typed, prefix (the format chosen on the items page) or group codes, with the separator and digits. Owners and admins. */
function CodeRuleForm({ rule, onSaved }: { rule: CodeRule; onSaved: () => void }) {
  const [form, setForm] = useState({ rule: rule.rule, separator: rule.separator, digits: rule.digits });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const example = ['10', '03'].join(form.separator) + form.separator + '7'.padStart(form.digits, '0');
  const changed = form.rule !== rule.rule || form.separator !== rule.separator || form.digits !== rule.digits;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/inventory/item-code-rule', { method: 'PUT', body: JSON.stringify(form) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-card stack" role="group" aria-label={tr('Item code rule')}>
      <div className="form-row">
        <label>
          {tr('Item code rule')}
          <select value={form.rule} onChange={(e) => setForm({ ...form, rule: e.target.value as CodeRule['rule'] })}>
            <option value="typed">{tr('Typed by hand')}</option>
            <option value="prefix">{tr('Prefix and a number (the SKU format)')}</option>
            <option value="group">{tr('Group codes and a number')}</option>
          </select>
        </label>
        {form.rule === 'group' ? (
          <>
            <label>
              {tr('Separator')}
              <select value={form.separator} onChange={(e) => setForm({ ...form, separator: e.target.value })}>
                {['-', '.', '/'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              {tr('Number of digits')}
              <select value={form.digits} onChange={(e) => setForm({ ...form, digits: Number(e.target.value) })}>
                {[2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </>
        ) : null}
      </div>
      {form.rule === 'group' ? (
        <p className="muted small">
          {trf('Example: {code}', { code: example })} {tr('Every new item then needs a group. Existing items keep their codes.')}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {changed ? (
        <div className="form-actions"><Button type="button" disabled={busy} onClick={() => void save()}>{busy ? tr('Saving…') : tr('Save rule')}</Button></div>
      ) : null}
    </div>
  );
}
