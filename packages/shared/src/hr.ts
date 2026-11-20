// The HR & payroll app link (sql/102; documentation/plans/HR_APP_INTEGRATION_PLAN.md). Read-only copies of the HR app's records.

export type HrEmployeeStatus = 'active' | 'on_leave' | 'terminated';

/** One row of the People directory. The detail fields are null unless the caller is an owner or admin. */
export type HrDirectoryRow = {
  id: string;
  externalId: string;
  employeeNumber: string | null;
  displayName: string;
  displayNameAr: string | null;
  jobTitle: string | null;
  jobTitleAr: string | null;
  status: HrEmployeeStatus;
  branchName: string | null;
  branchNameAr: string | null;
  departmentName: string | null;
  departmentNameAr: string | null;
  managerName: string | null;
  workEmail: string | null;
  hiredOn: string | null;
  leftOn: string | null;
  /** The linked ERP member, when there is one. */
  userId: string | null;
  linkSource: 'confirmed' | 'manual' | null;
  /** The linked member's role, or null when that member was switched off in the ERP. */
  memberRole: string | null;
  /** An active member with the same sign-in email, when exactly one matches and nobody is linked yet. */
  suggestedUserId: string | null;
};

export type HrDirectory = { total: number; rows: HrDirectoryRow[]; details: boolean };

export type HrUnit = {
  id: string;
  kind: 'branch' | 'department';
  externalId: string;
  code: string | null;
  name: string;
  nameAr: string | null;
  branchExternalId: string | null;
  coreBranchId: string | null;
  active: boolean;
};

export type HrSyncStatus = {
  requestedAt: string | null;
  lastFinishedAt: string | null;
  lastResult: 'ok' | 'partial' | 'failed' | null;
  lastError: string | null;
  lastWebhookAt: string | null;
  counts: Record<string, number>;
} | null;
