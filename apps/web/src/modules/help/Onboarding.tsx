import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
import { navigate } from '../../lib/router';
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
import { EXPLORE_ROUTES } from './onboardingShared';
import { WelcomeStep, BusinessStep, CompanyStep, StorageStep, WarehouseStep } from './OnboardingStepsEarly';
import { ItemsStep, PartyStep, TeamStep, ApprovalStep, DoneStep } from './OnboardingStepsLate';

// First-run setup wizard (documentation/plans/ONBOARDING_WIZARD_PLAN.md). Welcome, language, company, storage conditions, warehouses,
// items, suppliers, customers, team, approvals, then the tour. Every save goes through an existing API route (the same audited database
// functions as the normal screens); every step can be skipped. For the demo account only, "Fill with sample data" puts the cosmetics
// sample (sampleCompany.ts) straight into the form on screen, with no animation; the presenter can change anything, then saves.
// Progress is kept in this browser per company (onboardingContent.ts); nothing here is a business record.

export function OnboardingPage() {
  const session = useSession();
  const orgId = session.org?.id ?? 'none';
  const { lang } = useI18n();
  const c = onboardingContent(lang);
  const [step, setStep] = useState(() => readProgress(orgId).step);
  // D9: the answer to "What do you sell?" decides which steps are shown (stepsFor).
  const [business, setBusiness] = useState<BusinessType | null>(() => readProgress(orgId).business ?? null);
  const steps = stepsFor(business);
  const total = steps.length;
  const key = steps[step] ?? 'welcome';

  const go = (n: number, b: BusinessType | null = business) => {
    const count = stepsFor(b).length;
    const next = Math.max(0, Math.min(count - 1, n));
    setStep(next);
    writeProgress(orgId, { step: next, done: next === count - 1, business: b });
    window.scrollTo?.(0, 0);
  };
  const next = () => go(step + 1);
  const choose = (b: BusinessType) => {
    setBusiness(b);
    go(stepsFor(b).indexOf('business') + 1, b);
  };
  const leave = () => {
    writeProgress(orgId, { step, done: readProgress(orgId).done, business });
    localStorage.setItem(`erp.onboarding.dismissed.${orgId}`, '1');
    navigate('/start');
  };

  const s = c.steps[key];
  return (
    <section className="page">
      <div className="mx-auto max-w-5xl">
        <p className="m-0 text-sm text-muted-foreground">{c.stepOf(step + 1, total)}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step + 1} aria-label={c.stepOf(step + 1, total)}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${((step + 1) / total) * 100}%` }} />
        </div>
        <div className="mt-5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xs">
          <h1 className="m-0 text-xl font-semibold">{s.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          <div className="mt-5">
            {key === 'welcome' && (
              <WelcomeStep
                c={c}
                onStart={() => go(1)}
                onLater={leave}
                // the sample is a cosmetics company
                onFilledAll={() => {
                  setBusiness('cosmetics');
                  go(stepsFor('cosmetics').indexOf('team'), 'cosmetics');
                }}
              />
            )}
            {key === 'business' && <BusinessStep c={c} value={business} onChoose={choose} />}
            {key === 'company' && <CompanyStep c={c} onDone={next} />}
            {key === 'storage' && <StorageStep c={c} onDone={next} />}
            {key === 'warehouse' && <WarehouseStep c={c} onDone={next} />}
            {key === 'items' && <ItemsStep c={c} business={business} onDone={next} />}
            {key === 'suppliers' && <PartyStep c={c} kind="suppliers" onDone={next} />}
            {key === 'customers' && <PartyStep c={c} kind="customers" onDone={next} />}
            {key === 'team' && <TeamStep c={c} onDone={next} />}
            {key === 'approval' && <ApprovalStep c={c} onDone={next} />}
            {key === 'done' && <DoneStep c={c} orgId={orgId} step={total - 1} business={business} />}
          </div>
          <p className="m-0 mt-5 border-t border-border pt-3 text-sm">
            <a href={EXPLORE_ROUTES[key]} target="_blank" rel="noopener">
              {c.explore.label}: {c.explore.screens[key]} {lang === 'ar' ? '↖' : '↗'}
            </a>
            <span className="ms-2 text-xs text-muted-foreground">({c.explore.hint})</span>
          </p>
        </div>
        {key !== 'welcome' && key !== 'done' ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => go(step - 1)}>
              {c.back}
            </Button>
            <Button variant="ghost" onClick={next}>
              {c.skip}
            </Button>
          </div>
        ) : null}
        {key !== 'done' ? (
          <p className="mt-4 text-center text-xs">
            <button type="button" className="text-muted-foreground underline" onClick={leave}>
              {c.exit}
            </button>
          </p>
        ) : null}
      </div>
    </section>
  );
}
