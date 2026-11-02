import type { AuthUser, AccountCategory } from "./AuthScreen";

export type RecordStatus = "present" | "absent" | "late" | "excused" | "cancelled" | "half-day" | "on-leave" | "weekly-off" | "holiday" | "work-from-home" | "work" | "rest-day" | "leave";
export type AttendanceRow = {
  id: string;
  category: AccountCategory;
  recordDate: string;
  status: RecordStatus | string;
  subjectId: string | null;
  shiftId: string | null;
  projectId: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduledPayableMinutes: number;
  startAt: string | null;
  endAt: string | null;
  breakEntries: Array<{ startAt: string; endAt?: string | null; paid?: boolean; label?: string }>;
  operationKeys: string[];
  breakMinutes: number;
  actualMinutes: number;
  netMinutes: number;
  overtimeMinutes: number;
  overtimeStatus: "pending" | "approved" | "rejected" | string;
  overtimeMethod: string;
  overtimeCalculation: Record<string, unknown>;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubjectRow = {
  id: string;
  name: string;
  code: string | null;
  teacher: string | null;
  targetPercent: number;
  schedule: Array<{ weekday?: number; day?: number; startTime?: string; endTime?: string; label?: string }>;
};

export type ShiftRow = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  payableMinutes: number;
  breakRules: Array<Record<string, unknown>>;
  weekdays: number[];
  overtimeRules: Record<string, unknown>;
};

export type ProjectRow = { id: string; name: string; client: string | null; color: string; active: boolean };
export type NotificationRow = { id: string; kind: string; title: string; message: string; readAt: string | null; createdAt: string };
export type WorkspaceUser = AuthUser & { profile: Record<string, unknown>; preferences: Record<string, unknown>; emailVerified: boolean; createdAt: string; updatedAt: string };
export type WorkspaceData = { user: WorkspaceUser; records: AttendanceRow[]; subjects: SubjectRow[]; shifts: ShiftRow[]; projects: ProjectRow[]; notifications: NotificationRow[]; truncated?: boolean };

export type NavItem = { id: string; label: string; icon: string };

export function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function categoryLabel(category: AccountCategory) {
  return category === "self-employed" ? "Self-employed" : category.charAt(0).toUpperCase() + category.slice(1);
}

export function isCompleted(record: AttendanceRow) {
  return Boolean(record.startAt && record.endAt);
}
