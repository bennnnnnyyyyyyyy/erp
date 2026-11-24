// Reports & Insights, step 4: the sales forecast (sql/110; documentation/plans/REPORTS_INSIGHTS_PLAN.md section 7.4). The numbers are
// computed in the database with the stock forecast's method (sql/029): a weighted average of the last 90 days of sales.

export type SalesForecastBy = 'item' | 'customer';
export const SALES_FORECAST_HORIZONS = [30, 60, 90] as const;
export type SalesForecastHorizon = (typeof SALES_FORECAST_HORIZONS)[number];

/** Net value (without VAT) in one currency, in minor units: the three 30-day blocks, the rate per day and the forecast. */
export type SalesForecastValue = {
  currency: string;
  last30Minor: number;
  prev30Minor: number;
  oldest30Minor: number;
  dailyMinor: number;
  forecastMinor: number;
};

export type SalesForecastRow = {
  id: string;
  code: string | null;
  name: string;
  nameAr: string | null;
  /** Products only (a customer buys items in different units, so customers have no quantity). */
  uom: string | null;
  qtyLast30: number | null;
  qtyPrev30: number | null;
  qtyOldest30: number | null;
  dailyQty: number | null;
  forecastQty: number | null;
  invoices: number;
  historyDays: number;
  trend: 'up' | 'down' | 'flat';
  /** 'good' with at least 8 invoices over at least 60 days; else 'thin' (a guess). */
  confidence: 'good' | 'thin';
  values: SalesForecastValue[];
};

export type SalesForecast = { asOf: string; by: SalesForecastBy; horizon: SalesForecastHorizon; rows: SalesForecastRow[] };
