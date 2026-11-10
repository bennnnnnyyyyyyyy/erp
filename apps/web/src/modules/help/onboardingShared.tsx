import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { useSession } from '../../session';
import {
  BUSINESS_TYPES,
  onboardingContent,
  readProgress,
  STEP_KEYS,
  stepsFor,
  writeProgress,
  type BusinessType,
  type OnboardingContent,
} from './onboardingContent';
import {
  SAMPLE_APPROVAL,
  SAMPLE_COMPANY,
  SAMPLE_CONDITIONS,
  SAMPLE_CUSTOMERS,
  SAMPLE_ITEMS,
  SAMPLE_SUPPLIERS,
  SAMPLE_WAREHOUSES,
  type SampleCondition,
  type SampleItem,
  type SampleParty,
  type SampleWarehouse,
} from './sampleCompany';
import {
  canFillSample,
  FILL_STAGES,
  fillEverything,
  saveConditions,
  saveItems,
  saveParties,
  saveWarehouses,
  type FillStage,
  type OnProgress,
  type Report,
} from './sampleFill';

/** Where each step's "Explore more" goes: the real screen behind what the step sets up. */
export const EXPLORE_ROUTES: Record<(typeof STEP_KEYS)[number], string> = {
  welcome: '/guide',
  business: '/guide',
  company: '/settings',
  storage: '/inventory/batches',
  warehouse: '/inventory/stock',
  items: '/inventory/stock',
  suppliers: '/purchasing/suppliers',
  customers: '/sales/customers',
  team: '/settings/users',
  approval: '/inventory/approval-policies',
  done: '/',
};

export const inputClass = 'h-10 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm';

/** "Fill with sample data" is shown only to the accounts named in the build setting DEMO_AUTOFILL_EMAILS (the demo presenter). */
export function useCanFill(): boolean {
  const session = useSession();
  return canFillSample(session.email, import.meta.env.VITE_DEMO_AUTOFILL_EMAILS as string | undefined);
}

export function useList<T extends { id: string }>(path: string, enabled: boolean, version: number): T[] | null {
  const [rows, setRows] = useState<T[] | null>(null);
  useEffect(() => {
    if (!enabled) return setRows(null);
    let live = true;
    api<T[]>(path)
      .then((r) => live && setRows(Array.isArray(r) ? r : null))
      .catch(() => live && setRows(null));
    return () => {
      live = false;
    };
  }, [path, enabled, version]);
  return rows;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
