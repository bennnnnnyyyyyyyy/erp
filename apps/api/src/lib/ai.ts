import type { Bindings } from '../env';

// AI on our own keys is capped across all companies per month (Ben, 6 Nov 2026: USD 100 for now). A company's own key or Ollama is not counted.
export const DEFAULT_AI_CAP_USD = 100;

export const aiCapUsd = (env: Pick<Bindings, 'AI_MONTHLY_CAP_USD'>): number => {
  const n = Number(env.AI_MONTHLY_CAP_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AI_CAP_USD;
};
