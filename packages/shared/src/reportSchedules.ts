// Scheduled reports (Reports & Insights step 6, sql/112; documentation/plans/REPORTS_INSIGHTS_PLAN.md sections 3.3 and 7.6).

export const SCHEDULE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

/** What a send covers, in the company's time zone: whole days before the send day, except "this month" (up to the send day). */
export const SCHEDULE_PERIODS = ['yesterday', 'last_7_days', 'last_week', 'this_month', 'last_month'] as const;
export type SchedulePeriod = (typeof SCHEDULE_PERIODS)[number];

/** Who gets it: the same shape as alert recipients (sql/028). */
export type ScheduleRecipient =
  | { type: 'team'; id: string }
  | { type: 'role'; role: 'owner' | 'admin' | 'member' | 'viewer' }
  | { type: 'user'; id: string };

export type ReportSchedule = {
  id: string;
  reportId: string;
  reportName: string;
  reportDeleted: boolean;
  frequency: ScheduleFrequency;
  /** ISO weekday, 1 = Monday, for weekly. */
  weekday: number | null;
  /** 1 to 28, for monthly. */
  monthDay: number | null;
  /** 0 to 23, in the company's time zone. */
  sendHour: number;
  period: SchedulePeriod | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastSentAt: string | null;
  createdAt: string;
  recipients: ScheduleRecipient[];
};
