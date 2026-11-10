import { hasPermission } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { demoMode } from '../../lib/demo';
import { tr } from '../../lib/i18n';
import { navigate } from '../../lib/router';
import { useSession } from '../../session';

/** Phones only (the CSS hides it on wider screens): the warehouse clerk's three actions as big buttons at the bottom (inventory
 *  redesign Q5, Ben 10 Nov 2026). Each button shows only if this person may do it. Wording follows the task-first overview. */
export function ClerkActions() {
  const session = useSession();
  const can = (key: string) => hasPermission(session.permissions, key);
  const send = can('inventory.request.create');
  const receive = (session.modules.includes('purchasing') && can('purchasing.orders.receive')) || can('inventory.items.manage') || (!demoMode && can('inventory.batches.receive'));
  const count = !demoMode && can('inventory.adjustments.create');
  if (!send && !receive && !count) return null;
  return (
    <div className="clerk-actions" role="group" aria-label={tr('Quick actions')}>
      {send && <Button onClick={() => navigate('/inventory/requests/new')}>{tr('Send goods out')}</Button>}
      {receive && <Button variant="outline" onClick={() => navigate('/inventory/receive')}>{tr('Receive goods')}</Button>}
      {count && <Button variant="outline" onClick={() => navigate('/inventory/count')}>{tr('Count stock')}</Button>}
    </div>
  );
}
