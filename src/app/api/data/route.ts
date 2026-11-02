import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { attendanceRecords, notifications, overtimeAudit, projects, shifts, subjects, users } from "@/db/schema";
import type { JsonObject } from "@/db/schema";
import { calculateRecord, type BreakEntry } from "@/lib/attendance";
import { getAuthUser } from "@/lib/auth";
import { addDays, dateInTimezone, localDateTimeToUtc, shiftWindow } from "@/lib/time";

export const runtime = "nodejs";

const categoryValues = ["student", "employee", "self-employed"] as const;
const studentStatuses = ["present", "absent", "late", "excused", "cancelled"];
const employeeStatuses = ["present", "absent", "late", "half-day", "on-leave", "weekly-off", "holiday", "work-from-home"];
const selfStatuses = ["work", "rest-day", "holiday", "leave"];

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function originAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dateValue(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function instant(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeValue(value: unknown) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function allowedStatus(category: string, status: string) {
  if (category === "student") return studentStatuses.includes(status);
  if (category === "employee") return employeeStatuses.includes(status);
  return selfStatuses.includes(status);
}

function cleanJsonArray(value: unknown, maxLength = 60): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxLength).map((item) => object(item) as JsonObject);
}

function preferencesFor(user: { preferences: unknown }) {
  return object(user.preferences);
}

function employeePreferences(user: { preferences: unknown }) {
  return object(preferencesFor(user).employee);
}

function shiftOvertimeOptions(user: { preferences: unknown }, shiftRules: unknown, baseline: number, status: string) {
  const prefs = employeePreferences(user);
  const rules = { ...object(prefs.overtime), ...object(shiftRules) };
  const method = stringValue(rules.method, 40) || "scheduled-shift";
  const offDay = status === "weekly-off" || status === "holiday" || status === "rest-day" || status === "leave";
  return {
    method: method === "weekly-threshold" ? "weekly-threshold" : method === "daily-threshold" ? "daily-threshold" : "scheduled-shift",
    earlyArrivalEligible: Boolean(rules.earlyArrivalEligible),
    afterShiftEligible: rules.afterShiftEligible !== false,
    minOvertimeMinutes: Number(rules.minOvertimeMinutes ?? 0),
    roundingMinutes: Number(rules.roundingMinutes ?? 1),
    maxDailyMinutes: typeof rules.maxDailyMinutes === "number" ? rules.maxDailyMinutes : null,
    dailyThresholdMinutes: Number(rules.dailyThresholdMinutes ?? (offDay && rules.holidayOvertime !== false ? 0 : baseline || 480)), 
    weeklyThresholdMinutes: Number(rules.weeklyThresholdMinutes ?? 2400),
    gracePeriodMinutes: Math.max(0, Number(rules.gracePeriodMinutes ?? prefs.gracePeriodMinutes ?? 0)),
    approvalRequired: Boolean(rules.approvalRequired),
    holidayOvertime: rules.holidayOvertime !== false,
    offDay,
  };
}

async function isOwned(id: string, table: "subjects" | "shifts" | "projects", userId: string) {
  if (!id) return false;
  const selected = table === "subjects" ? subjects : table === "shifts" ? shifts : projects;
  const [row] = await db.select({ id: selected.id }).from(selected).where(and(eq(selected.id, id), eq(selected.userId, userId))).limit(1);
  return Boolean(row);
}

function weekStart(date: string) {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

async function applyWeeklyOvertime(user: { id: string; preferences: unknown }, date: string, threshold: number, minimum: number, rounding: number, approvalRequired: boolean) {
  const start = weekStart(date);
  const end = addDays(start, 6);
  const rows = await db.select().from(attendanceRecords).where(and(
    eq(attendanceRecords.userId, user.id),
    eq(attendanceRecords.category, "employee"),
    gte(attendanceRecords.recordDate, start),
    lte(attendanceRecords.recordDate, end),
  ));
  const completed = rows.filter((record) => record.startAt && record.endAt).sort((a, b) =>
    a.recordDate.localeCompare(b.recordDate) || new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime(),
  );
  let accrued = 0;
  for (const record of completed) {
    const before = accrued;
    accrued += record.netMinutes;
    let allocated = Math.max(0, accrued - threshold) - Math.max(0, before - threshold);
    if (allocated < minimum) allocated = 0;
    if (rounding > 1) allocated = Math.round(allocated / rounding) * rounding;
    if (record.overtimeMinutes === allocated && record.overtimeMethod === "weekly-threshold") continue;
    const calculation: JsonObject = {
      ...object(record.overtimeCalculation),
      method: "weekly-threshold",
      formula: "max(0, cumulative weekly net work − weekly threshold), allocated in timestamp order",
      weekStart: start,
      weeklyThresholdMinutes: threshold,
      cumulativeBeforeMinutes: before,
      cumulativeAfterMinutes: accrued,
      overtimeMinutes: allocated,
      overlapHandling: "Weekly threshold is exclusive; minutes are never counted again as daily overtime.",
    };
    await db.update(attendanceRecords).set({
      overtimeMinutes: allocated,
      overtimeMethod: "weekly-threshold",
      overtimeCalculation: calculation,
      overtimeStatus: approvalRequired && allocated > 0 ? (record.overtimeStatus === "approved" ? "pending" : record.overtimeStatus) : record.overtimeStatus,
      updatedAt: new Date(),
    }).where(and(eq(attendanceRecords.id, record.id), eq(attendanceRecords.userId, user.id)));
    await db.insert(overtimeAudit).values({ userId: user.id, recordId: record.id, action: "weekly-recalculated", calculation });
  }
}

async function saveAttendanceRecord(user: NonNullable<Awaited<ReturnType<typeof getAuthUser>>>, body: Record<string, unknown>) {
  const category = stringValue(body.category, 32) || user.category;
  if (!categoryValues.includes(category as typeof categoryValues[number]) || category !== user.category) {
    return { error: "You can only create attendance in your account category.", status: 403 as const };
  }
  const recordDate = dateValue(body.recordDate);
  if (!recordDate) return { error: "Choose a valid attendance date.", status: 400 as const };
  let status = stringValue(body.status, 32) || (category === "self-employed" ? "work" : "present");
  if (!allowedStatus(category, status)) return { error: "Choose a valid attendance status.", status: 400 as const };
  const subjectId = stringValue(body.subjectId, 64) || null;
  const shiftId = stringValue(body.shiftId, 64) || null;
  const projectId = stringValue(body.projectId, 64) || null;
  for (const [id, table, label] of [[subjectId, "subjects", "subject"], [shiftId, "shifts", "shift"], [projectId, "projects", "project"]] as const) {
    if (id && !(await isOwned(id, table, user.id))) return { error: `That ${label} does not belong to this account.`, status: 403 as const };
  }

  const timezone = stringValue(user.timezone, 80) || "Asia/Kolkata";
  const breaks = cleanJsonArray(body.breakEntries, 40) as BreakEntry[];
  let startAt = instant(body.startAt);
  let endAt = instant(body.endAt);
  if (body.startLocalTime && typeof body.startLocalTime === "string") startAt = localDateTimeToUtc(recordDate, body.startLocalTime, timezone);
  if (body.endLocalTime && typeof body.endLocalTime === "string") {
    const endDate = body.endNextDay === true ? addDays(recordDate, 1) : recordDate;
    endAt = localDateTimeToUtc(endDate, body.endLocalTime, timezone);
  }
  let scheduledStartAt = instant(body.scheduledStartAt);
  let scheduledEndAt = instant(body.scheduledEndAt);
  let scheduledPayableMinutes = Math.max(0, Math.min(1440, Math.floor(Number(body.scheduledPayableMinutes ?? 0) || 0)));
  let shiftRules: unknown = {};
  if (shiftId) {
    const [shift] = await db.select().from(shifts).where(and(eq(shifts.id, shiftId), eq(shifts.userId, user.id))).limit(1);
    if (shift) {
      const window = shiftWindow(recordDate, shift.startTime, shift.endTime, timezone);
      scheduledStartAt = window.start;
      scheduledEndAt = window.end;
      scheduledPayableMinutes = shift.payableMinutes;
      shiftRules = shift.overtimeRules;
    }
  }

  if (category === "employee" && status === "present" && startAt && scheduledStartAt) {
    const employeePrefs = employeePreferences(user);
    const configuredGrace = Number(object(shiftRules).gracePeriodMinutes ?? employeePrefs.gracePeriodMinutes ?? 0);
    if (startAt.getTime() > scheduledStartAt.getTime() + Math.max(0, configuredGrace) * 60_000) status = "late";
  }
  const employeeRule = shiftOvertimeOptions(user, shiftRules, scheduledPayableMinutes, status);
  const effectivePayableMinutes = employeeRule.offDay && employeeRule.holidayOvertime
    ? 0
    : scheduledPayableMinutes;
  const result = category === "employee"
    ? calculateRecord({
      startAt,
      endAt,
      scheduledStartAt,
      scheduledEndAt,
      scheduledPayableMinutes: effectivePayableMinutes,
      breakEntries: breaks,
      overtimeOptions: employeeRule,
      status,
    })
    : calculateRecord({ startAt, endAt, breakEntries: breaks, status });
  if (category === "employee" && endAt && ["present", "late"].includes(status)) {
    const halfDayMinutes = Math.max(0, Number(employeePreferences(user).halfDayMinimumHours ?? 4) * 60);
    if (halfDayMinutes > 0 && result.netMinutes < halfDayMinutes) status = "half-day";
  }
  const id = stringValue(body.id, 64);
  const clientKey = stringValue(body.clientKey, 100) || null;
  const existing = id
    ? (await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.id, id), eq(attendanceRecords.userId, user.id), eq(attendanceRecords.category, category))).limit(1))[0]
    : clientKey
      ? (await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.userId, user.id), eq(attendanceRecords.clientKey, clientKey))).limit(1))[0]
      : undefined;

  const statusForOvertime = employeeRule.approvalRequired && result.overtimeMinutes > 0 ? "pending" : "approved";
  const values = {
    userId: user.id,
    category,
    recordDate,
    status,
    subjectId,
    shiftId,
    projectId,
    scheduledStartAt,
    scheduledEndAt,
    scheduledPayableMinutes,
    startAt,
    endAt,
    breakEntries: breaks as JsonObject[],
    breakMinutes: result.breakMinutes,
    actualMinutes: result.actualMinutes,
    netMinutes: result.netMinutes,
    overtimeMinutes: employeeRule.method === "weekly-threshold" ? 0 : result.overtimeMinutes,
    overtimeStatus: employeeRule.method === "weekly-threshold" ? (employeeRule.approvalRequired ? "pending" : "approved") : statusForOvertime,
    overtimeMethod: result.overtimeMethod,
    overtimeCalculation: employeeRule.method === "weekly-threshold"
      ? { ...result.overtimeCalculation, method: "weekly-threshold", formula: "Weekly threshold allocated chronologically after all weekly sessions are closed." }
      : result.overtimeCalculation,
    note: stringValue(body.note, 4000) || null,
    clientKey,
    updatedAt: new Date(),
  };
  let saved;
  if (existing) {
    [saved] = await db.update(attendanceRecords).set(values).where(and(eq(attendanceRecords.id, existing.id), eq(attendanceRecords.userId, user.id))).returning();
  } else {
    const [created] = await db.insert(attendanceRecords).values(values).returning();
    saved = created;
  }
  if (!saved) return { error: "Unable to save this attendance entry.", status: 500 as const };

  if (category === "employee" && endAt) {
    const before = existing?.overtimeMinutes ?? 0;
    if (employeeRule.method === "weekly-threshold") {
      await applyWeeklyOvertime(user, recordDate, employeeRule.weeklyThresholdMinutes, employeeRule.minOvertimeMinutes, employeeRule.roundingMinutes, employeeRule.approvalRequired);
      const [updated] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.id, saved.id), eq(attendanceRecords.userId, user.id))).limit(1);
      if (updated) saved = updated;
    } else if (!existing || before !== result.overtimeMinutes || JSON.stringify(existing.overtimeCalculation) !== JSON.stringify(result.overtimeCalculation)) {
      await db.insert(overtimeAudit).values({ userId: user.id, recordId: saved.id, action: existing ? "recalculated" : "calculated", calculation: result.overtimeCalculation, note: stringValue(body.note, 800) || null });
    }
    if (saved.overtimeMinutes > before && saved.overtimeMinutes > 0) {
      await db.insert(notifications).values({
        userId: user.id,
        kind: "overtime-completed",
        title: "Overtime recorded",
        message: `${saved.overtimeMinutes} extra minutes were calculated for ${recordDate}.`,
      });
    }
  }
  return { record: saved, status: existing ? 200 as const : 201 as const };
}

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return json({ error: "Sign in to view your private workspace." }, 401);
  const url = new URL(request.url);
  const from = dateValue(url.searchParams.get("from"));
  const through = dateValue(url.searchParams.get("through"));
  const conditions = [eq(attendanceRecords.userId, user.id)];
  if (from) conditions.push(gte(attendanceRecords.recordDate, from));
  if (through) conditions.push(lte(attendanceRecords.recordDate, through));
  const [records, subjectList, shiftList, projectList, notificationList] = await Promise.all([
    db.select().from(attendanceRecords).where(and(...conditions)).orderBy(desc(attendanceRecords.recordDate), desc(attendanceRecords.createdAt)).limit(500),
    db.select().from(subjects).where(eq(subjects.userId, user.id)).orderBy(asc(subjects.name)),
    db.select().from(shifts).where(eq(shifts.userId, user.id)).orderBy(asc(shifts.name)),
    db.select().from(projects).where(eq(projects.userId, user.id)).orderBy(asc(projects.name)),
    db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(30),
  ]);
  return json({ user, records, subjects: subjectList, shifts: shiftList, projects: projectList, notifications: notificationList, truncated: records.length === 500 });
}

export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: "Request origin could not be verified." }, 403);
  const user = await getAuthUser(request);
  if (!user) return json({ error: "Your session has expired. Please sign in again." }, 401);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "A valid JSON request is required." }, 400);
  }
  const action = stringValue(body.action, 48);

  if (action === "record.save") {
    const result = await saveAttendanceRecord(user, body);
    return "error" in result ? json({ error: result.error }, result.status) : json({ record: result.record }, result.status);
  }

  if (action === "record.delete") {
    const id = stringValue(body.id, 64);
    if (!id) return json({ error: "Choose a record to delete." }, 400);
    await db.delete(attendanceRecords).where(and(eq(attendanceRecords.id, id), eq(attendanceRecords.userId, user.id)));
    return json({ ok: true });
  }

  if (action === "student.bulk-mark") {
    if (user.category !== "student") return json({ error: "Bulk class attendance is available for student accounts." }, 403);
    const subjectId = stringValue(body.subjectId, 64);
    if (!(await isOwned(subjectId, "subjects", user.id))) return json({ error: "Choose one of your subjects." }, 400);
    const entries = Array.isArray(body.entries) ? body.entries.slice(0, 60) : [];
    if (!entries.length) return json({ error: "Add at least one class date." }, 400);
    const results = [];
    for (const entry of entries) {
      const item = object(entry);
      const recordDate = dateValue(item.recordDate);
      const status = stringValue(item.status, 32);
      if (!recordDate || !allowedStatus("student", status)) continue;
      const [existing] = await db.select({ id: attendanceRecords.id }).from(attendanceRecords).where(and(
        eq(attendanceRecords.userId, user.id),
        eq(attendanceRecords.category, "student"),
        eq(attendanceRecords.subjectId, subjectId),
        eq(attendanceRecords.recordDate, recordDate),
      )).limit(1);
      const saved = await saveAttendanceRecord(user, { ...item, id: existing?.id, recordDate, status, subjectId, category: "student" });
      if (!("error" in saved) && saved.record) results.push(saved.record);
    }
    return json({ records: results, saved: results.length }, 200);
  }

  if (action === "subject.save") {
    if (user.category !== "student") return json({ error: "Subjects belong to student accounts." }, 403);
    const name = stringValue(body.name, 140);
    if (name.length < 2) return json({ error: "Enter a subject name." }, 400);
    const targetPercent = Math.max(0, Math.min(100, Math.floor(Number(body.targetPercent ?? 75))));
    const values = {
      name,
      code: stringValue(body.code, 48) || null,
      teacher: stringValue(body.teacher, 140) || null,
      targetPercent,
      schedule: cleanJsonArray(body.schedule, 40),
      updatedAt: new Date(),
    };
    const id = stringValue(body.id, 64);
    if (id) {
      const [subject] = await db.update(subjects).set(values).where(and(eq(subjects.id, id), eq(subjects.userId, user.id))).returning();
      if (!subject) return json({ error: "Subject not found." }, 404);
      return json({ subject });
    }
    const [subject] = await db.insert(subjects).values({ ...values, userId: user.id }).returning();
    return json({ subject }, 201);
  }

  if (action === "subject.delete") {
    const id = stringValue(body.id, 64);
    if (!id) return json({ error: "Choose a subject to delete." }, 400);
    await db.delete(subjects).where(and(eq(subjects.id, id), eq(subjects.userId, user.id)));
    return json({ ok: true });
  }

  if (action === "shift.save") {
    if (user.category !== "employee") return json({ error: "Shifts belong to employee accounts." }, 403);
    const name = stringValue(body.name, 100);
    const startTime = timeValue(body.startTime);
    const endTime = timeValue(body.endTime);
    const payableMinutes = Math.max(0, Math.min(1440, Math.floor(Number(body.payableMinutes ?? 480))));
    if (name.length < 2 || !startTime || !endTime || payableMinutes < 1) return json({ error: "Provide a shift name, valid times and payable duration." }, 400);
    const weekdays = Array.isArray(body.weekdays) ? body.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6).slice(0, 7) : [1, 2, 3, 4, 5];
    const values = {
      name,
      startTime,
      endTime,
      payableMinutes,
      breakRules: cleanJsonArray(body.breakRules, 20),
      weekdays,
      overtimeRules: object(body.overtimeRules) as JsonObject,
      updatedAt: new Date(),
    };
    const id = stringValue(body.id, 64);
    if (id) {
      const [shift] = await db.update(shifts).set(values).where(and(eq(shifts.id, id), eq(shifts.userId, user.id))).returning();
      if (!shift) return json({ error: "Shift not found." }, 404);
      return json({ shift });
    }
    const [shift] = await db.insert(shifts).values({ ...values, userId: user.id }).returning();
    return json({ shift }, 201);
  }

  if (action === "shift.delete") {
    const id = stringValue(body.id, 64);
    if (!id) return json({ error: "Choose a shift to delete." }, 400);
    await db.delete(shifts).where(and(eq(shifts.id, id), eq(shifts.userId, user.id)));
    return json({ ok: true });
  }

  if (action === "project.save") {
    if (user.category !== "self-employed") return json({ error: "Projects belong to self-employed accounts." }, 403);
    const name = stringValue(body.name, 140);
    if (name.length < 2) return json({ error: "Enter a project name." }, 400);
    const values = {
      name,
      client: stringValue(body.client, 140) || null,
      color: /^#[0-9a-fA-F]{6}$/.test(stringValue(body.color, 7)) ? stringValue(body.color, 7) : "#3b7d68",
      active: body.active !== false,
      updatedAt: new Date(),
    };
    const id = stringValue(body.id, 64);
    if (id) {
      const [project] = await db.update(projects).set(values).where(and(eq(projects.id, id), eq(projects.userId, user.id))).returning();
      if (!project) return json({ error: "Project not found." }, 404);
      return json({ project });
    }
    const [project] = await db.insert(projects).values({ ...values, userId: user.id }).returning();
    return json({ project }, 201);
  }

  if (action === "project.delete") {
    const id = stringValue(body.id, 64);
    if (!id) return json({ error: "Choose a project to delete." }, 400);
    await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, user.id)));
    return json({ ok: true });
  }

  if (action === "profile.save") {
    const fullName = stringValue(body.fullName, 160);
    const timezone = stringValue(body.timezone, 80);
    if (fullName.length < 2) return json({ error: "Enter your full name." }, 400);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    } catch {
      return json({ error: "Choose a valid IANA timezone." }, 400);
    }
    const [updated] = await db.update(users).set({
      fullName,
      timezone,
      profile: { ...object(user.profile), ...object(body.profile) },
      avatarUrl: typeof object(body.profile).avatarUrl === "string" && String(object(body.profile).avatarUrl).startsWith("https://") ? String(object(body.profile).avatarUrl).slice(0, 2000) : null,
      preferences: { ...object(user.preferences), ...object(body.preferences) },
      updatedAt: new Date(),
    }).where(eq(users.id, user.id)).returning();
    const { passwordHash: _passwordHash, ...safe } = updated;
    return json({ user: safe });
  }

  if (action === "settings.save") {
    const preferences = { ...object(user.preferences), ...object(body.preferences) };
    const [updated] = await db.update(users).set({ preferences, updatedAt: new Date() }).where(eq(users.id, user.id)).returning();
    const { passwordHash: _passwordHash, ...safe } = updated;
    return json({ user: safe });
  }

  if (action === "attendance.clock-in") {
    if (user.category === "student") return json({ error: "Students mark individual classes rather than clocking in." }, 403);
    const requestKey = stringValue(body.requestId ?? body.clientKey, 100);
    if (requestKey) {
      const [alreadyCreated] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.userId, user.id), eq(attendanceRecords.clientKey, requestKey))).limit(1);
      if (alreadyCreated) return json({ record: alreadyCreated });
    }
    const active = await db.select({ id: attendanceRecords.id }).from(attendanceRecords).where(and(
      eq(attendanceRecords.userId, user.id),
      eq(attendanceRecords.category, user.category),
      sql`${attendanceRecords.startAt} is not null`,
      sql`${attendanceRecords.endAt} is null`,
    )).limit(1);
    if (active.length) return json({ error: "You already have an active work session. End it before starting another." }, 409);
    const now = new Date();
    const recordDate = dateInTimezone(now, user.timezone);
    const shiftId = stringValue(body.shiftId, 64) || null;
    const projectId = stringValue(body.projectId, 64) || null;
    if (shiftId && !(await isOwned(shiftId, "shifts", user.id))) return json({ error: "That shift does not belong to this account." }, 403);
    if (projectId && !(await isOwned(projectId, "projects", user.id))) return json({ error: "That project does not belong to this account." }, 403);
    const shift = shiftId
      ? (await db.select().from(shifts).where(and(eq(shifts.id, shiftId), eq(shifts.userId, user.id))).limit(1))[0]
      : undefined;
    const window = shift ? shiftWindow(recordDate, shift.startTime, shift.endTime, user.timezone) : null;
    const employeePrefs = employeePreferences(user);
    const profilePrefs = object(user.profile);
    const weekday = new Date(`${recordDate}T12:00:00.000Z`).getUTCDay();
    const workingDays = Array.isArray(profilePrefs.workingDays) ? profilePrefs.workingDays as number[] : [1, 2, 3, 4, 5];
    const weeklyOffDays = Array.isArray(employeePrefs.weeklyDaysOff) ? employeePrefs.weeklyDaysOff as number[] : workingDays.length ? [0, 1, 2, 3, 4, 5, 6].filter((day) => !workingDays.includes(day)) : [0, 6];
    const holidayDates = Array.isArray(employeePrefs.holidays) ? employeePrefs.holidays as string[] : [];
    const gracePeriodMinutes = Number(object(shift?.overtimeRules).gracePeriodMinutes ?? employeePrefs.gracePeriodMinutes ?? 0);
    const lateAtCheckIn = Boolean(window && now.getTime() > window.start.getTime() + Math.max(0, gracePeriodMinutes) * 60_000);
    const sessionStatus = user.category === "employee" ? holidayDates.includes(recordDate) ? "holiday" : weeklyOffDays.includes(weekday) ? "weekly-off" : lateAtCheckIn ? "late" : "present" : "work";
    const [record] = await db.insert(attendanceRecords).values({
      userId: user.id,
      category: user.category,
      recordDate,
      status: sessionStatus,
      shiftId: shift?.id ?? null,
      projectId,
      scheduledStartAt: window?.start ?? null,
      scheduledEndAt: window?.end ?? null,
      scheduledPayableMinutes: shift?.payableMinutes ?? 0,
      startAt: now,
      breakEntries: [],
      clientKey: requestKey || null,
      note: stringValue(body.note, 2000) || null,
    }).returning();
    return json({ record }, 201);
  }

  if (["attendance.clock-out", "attendance.break-start", "attendance.break-end"].includes(action)) {
    if (user.category === "student") return json({ error: "This action is not available for student accounts." }, 403);
    const requestKey = stringValue(body.requestId, 100);
    const requestedRecordId = stringValue(body.recordId, 64);
    let active = requestedRecordId
      ? (await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.id, requestedRecordId), eq(attendanceRecords.userId, user.id), eq(attendanceRecords.category, user.category))).limit(1))[0]
      : undefined;
    if (active && requestKey && active.operationKeys?.includes(requestKey)) return json({ record: active });
    if (!active || active.endAt) {
      [active] = await db.select().from(attendanceRecords).where(and(
        eq(attendanceRecords.userId, user.id),
        eq(attendanceRecords.category, user.category),
        sql`${attendanceRecords.startAt} is not null`,
        sql`${attendanceRecords.endAt} is null`,
      )).orderBy(desc(attendanceRecords.startAt)).limit(1);
    }
    if (!active) return json({ error: "There is no active work session." }, 409);
    const breaks = (active.breakEntries ?? []) as Array<BreakEntry & { key?: string; endRequestId?: string }>;
    const operationKeys = [...(active.operationKeys ?? [])];
    const now = new Date();
    if (action === "attendance.break-start") {
      if (requestKey && breaks.some((entry) => entry.key === requestKey)) return json({ record: active });
      if (breaks.some((entry) => !entry.endAt)) return json({ error: "End your current break before starting another." }, 409);
      breaks.push({ startAt: now.toISOString(), endAt: null, paid: body.paid === true, label: stringValue(body.label, 80) || "Break", key: requestKey });
      if (requestKey) operationKeys.push(requestKey);
      const [record] = await db.update(attendanceRecords).set({ breakEntries: breaks as JsonObject[], operationKeys, updatedAt: now }).where(and(eq(attendanceRecords.id, active.id), eq(attendanceRecords.userId, user.id))).returning();
      return json({ record });
    }
    if (action === "attendance.break-end") {
      const current = [...breaks].reverse().find((entry) => !entry.endAt);
      if (!current) return requestKey && operationKeys.includes(requestKey) ? json({ record: active }) : json({ error: "There is no active break to end." }, 409);
      current.endAt = now.toISOString();
      current.endRequestId = requestKey;
      if (requestKey) operationKeys.push(requestKey);
      const [record] = await db.update(attendanceRecords).set({ breakEntries: breaks as JsonObject[], operationKeys, updatedAt: now }).where(and(eq(attendanceRecords.id, active.id), eq(attendanceRecords.userId, user.id))).returning();
      return json({ record });
    }
    if (active.endAt) return json({ record: active });
    if (breaks.some((entry) => !entry.endAt)) return json({ error: "End your active break before checking out." }, 409);
    const endAt = now;
    const [assignedShift] = active.shiftId ? await db.select().from(shifts).where(and(eq(shifts.id, active.shiftId), eq(shifts.userId, user.id))).limit(1) : [];
    const overtimeRules = shiftOvertimeOptions(user, assignedShift?.overtimeRules ?? {}, active.scheduledPayableMinutes, active.status);
    const result = user.category === "employee"
      ? calculateRecord({
        startAt: active.startAt,
        endAt,
        scheduledStartAt: active.scheduledStartAt,
        scheduledEndAt: active.scheduledEndAt,
        scheduledPayableMinutes: overtimeRules.offDay && overtimeRules.holidayOvertime ? 0 : active.scheduledPayableMinutes,
        breakEntries: breaks,
        overtimeOptions: overtimeRules,
        status: active.status,
      })
      : calculateRecord({ startAt: active.startAt, endAt, breakEntries: breaks });
    const overtimeStatus = overtimeRules.approvalRequired && result.overtimeMinutes > 0 ? "pending" : "approved";
    const halfDayMinimum = Math.max(0, Number(employeePreferences(user).halfDayMinimumHours ?? 4) * 60);
    const finalStatus = user.category === "employee" && ["present", "late"].includes(active.status) && halfDayMinimum > 0 && result.netMinutes < halfDayMinimum ? "half-day" : active.status;
    if (requestKey) operationKeys.push(requestKey);
    const [record] = await db.update(attendanceRecords).set({
      endAt,
      status: finalStatus,
      operationKeys,
      breakMinutes: result.breakMinutes,
      actualMinutes: result.actualMinutes,
      netMinutes: result.netMinutes,
      overtimeMinutes: overtimeRules.method === "weekly-threshold" ? 0 : result.overtimeMinutes,
      overtimeStatus,
      overtimeMethod: result.overtimeMethod,
      overtimeCalculation: result.overtimeCalculation,
      updatedAt: now,
    }).where(and(eq(attendanceRecords.id, active.id), eq(attendanceRecords.userId, user.id))).returning();
    if (user.category === "employee") {
      await db.insert(overtimeAudit).values({ userId: user.id, recordId: record.id, action: "calculated", calculation: result.overtimeCalculation });
      if (overtimeRules.method === "weekly-threshold") {
        await applyWeeklyOvertime(user, active.recordDate, overtimeRules.weeklyThresholdMinutes, overtimeRules.minOvertimeMinutes, overtimeRules.roundingMinutes, overtimeRules.approvalRequired);
      }
      if (record.overtimeMinutes > 0) await db.insert(notifications).values({ userId: user.id, kind: "overtime-completed", title: "Overtime recorded", message: `${record.overtimeMinutes} extra minutes were calculated for ${record.recordDate}.` });
    }
    return json({ record });
  }

  if (action === "overtime.status") {
    if (user.category !== "employee") return json({ error: "Overtime review is for employee accounts." }, 403);
    const id = stringValue(body.id, 64);
    const status = stringValue(body.status, 24);
    if (!id || !["pending", "approved", "rejected"].includes(status)) return json({ error: "Choose a valid overtime record and status." }, 400);
    const [record] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.id, id), eq(attendanceRecords.userId, user.id), eq(attendanceRecords.category, "employee"))).limit(1);
    if (!record) return json({ error: "Overtime record not found." }, 404);
    const [updated] = await db.update(attendanceRecords).set({ overtimeStatus: status, updatedAt: new Date() }).where(and(eq(attendanceRecords.id, id), eq(attendanceRecords.userId, user.id))).returning();
    await db.insert(overtimeAudit).values({ userId: user.id, recordId: id, action: `status-${status}`, calculation: record.overtimeCalculation, note: stringValue(body.note, 2000) || null });
    await db.insert(notifications).values({ userId: user.id, kind: "overtime-status", title: `Overtime ${status}`, message: stringValue(body.note, 300) || `Your overtime for ${record.recordDate} is now ${status}.` });
    return json({ record: updated });
  }

  if (action === "notification.read") {
    const id = stringValue(body.id, 64);
    if (!id) return json({ error: "Choose a notification." }, 400);
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
    return json({ ok: true });
  }

  if (action === "notifications.read-all") {
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`));
    return json({ ok: true });
  }

  if (action === "data.import") {
    const backup = object(body.backup);
    const sourceUser = object(backup.user);
    if (sourceUser.category !== user.category) return json({ error: "This backup was created for a different account category." }, 400);
    const sourceOwner = stringValue(sourceUser.id, 64);
    if (!sourceOwner) return json({ error: "The backup does not contain a valid source account." }, 400);
    const sourceSubjects = Array.isArray(backup.subjects) ? backup.subjects.slice(0, 300) : [];
    const sourceShifts = Array.isArray(backup.shifts) ? backup.shifts.slice(0, 200) : [];
    const sourceProjects = Array.isArray(backup.projects) ? backup.projects.slice(0, 300) : [];
    const sourceRecords = Array.isArray(backup.records) ? backup.records.slice(0, 5000) : [];
    const sourceAudit = Array.isArray(backup.overtimeAudit) ? backup.overtimeAudit.slice(0, 10000) : [];
    const subjectMap = new Map<string, string>();
    const shiftMap = new Map<string, string>();
    const projectMap = new Map<string, string>();
    const recordMap = new Map<string, string>();
    let addedSubjects = 0;
    let addedShifts = 0;
    let addedProjects = 0;
    let addedRecords = 0;
    let addedAudit = 0;
    await db.transaction(async (tx) => {
      for (const raw of sourceSubjects) {
        const entry = object(raw);
        const oldId = stringValue(entry.id, 64);
        const name = stringValue(entry.name, 140);
        if (!oldId || name.length < 2 || user.category !== "student") continue;
        const [existing] = await tx.select().from(subjects).where(and(eq(subjects.userId, user.id), eq(subjects.name, name))).limit(1);
        if (existing) { subjectMap.set(oldId, existing.id); continue; }
        const [created] = await tx.insert(subjects).values({
          userId: user.id,
          name,
          code: stringValue(entry.code, 48) || null,
          teacher: stringValue(entry.teacher, 140) || null,
          targetPercent: Math.max(0, Math.min(100, Math.floor(Number(entry.targetPercent ?? 75)))),
          schedule: cleanJsonArray(entry.schedule, 40),
        }).returning();
        subjectMap.set(oldId, created.id); addedSubjects += 1;
      }
      for (const raw of sourceShifts) {
        const entry = object(raw);
        const oldId = stringValue(entry.id, 64);
        const name = stringValue(entry.name, 100);
        const startTime = timeValue(entry.startTime);
        const endTime = timeValue(entry.endTime);
        if (!oldId || name.length < 2 || !startTime || !endTime || user.category !== "employee") continue;
        const [existing] = await tx.select().from(shifts).where(and(eq(shifts.userId, user.id), eq(shifts.name, name), eq(shifts.startTime, startTime), eq(shifts.endTime, endTime))).limit(1);
        if (existing) { shiftMap.set(oldId, existing.id); continue; }
        const [created] = await tx.insert(shifts).values({
          userId: user.id,
          name,
          startTime,
          endTime,
          payableMinutes: Math.max(1, Math.min(1440, Math.floor(Number(entry.payableMinutes ?? 480)))),
          weekdays: Array.isArray(entry.weekdays) ? entry.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6).slice(0, 7) : [1, 2, 3, 4, 5],
          breakRules: cleanJsonArray(entry.breakRules, 20),
          overtimeRules: object(entry.overtimeRules) as JsonObject,
        }).returning();
        shiftMap.set(oldId, created.id); addedShifts += 1;
      }
      for (const raw of sourceProjects) {
        const entry = object(raw);
        const oldId = stringValue(entry.id, 64);
        const name = stringValue(entry.name, 140);
        if (!oldId || name.length < 2 || user.category !== "self-employed") continue;
        const [existing] = await tx.select().from(projects).where(and(eq(projects.userId, user.id), eq(projects.name, name))).limit(1);
        if (existing) { projectMap.set(oldId, existing.id); continue; }
        const color = stringValue(entry.color, 7);
        const [created] = await tx.insert(projects).values({ userId: user.id, name, client: stringValue(entry.client, 140) || null, color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#3b7d68", active: entry.active !== false }).returning();
        projectMap.set(oldId, created.id); addedProjects += 1;
      }
      const timezone = stringValue(user.timezone, 80) || "Asia/Kolkata";
      for (const raw of sourceRecords) {
        const entry = object(raw);
        const oldId = stringValue(entry.id, 64);
        const recordDate = dateValue(entry.recordDate);
        const status = stringValue(entry.status, 32);
        if (!oldId || !recordDate || entry.category !== user.category || !allowedStatus(user.category, status)) continue;
        const sourceKey = `backup:${sourceOwner}:${oldId}`.slice(0, 100);
        const [existing] = await tx.select({ id: attendanceRecords.id }).from(attendanceRecords).where(and(eq(attendanceRecords.userId, user.id), eq(attendanceRecords.clientKey, sourceKey))).limit(1);
        if (existing) { recordMap.set(oldId, existing.id); continue; }
        const rawStart = instant(entry.startAt);
        const rawEnd = instant(entry.endAt);
        const subjectId = subjectMap.get(stringValue(entry.subjectId, 64)) ?? null;
        const shiftId = shiftMap.get(stringValue(entry.shiftId, 64)) ?? null;
        const projectId = projectMap.get(stringValue(entry.projectId, 64)) ?? null;
        const breaks = cleanJsonArray(entry.breakEntries, 40).map((item) => ({
          ...item,
          startAt: instant(item.startAt)?.toISOString() ?? "",
          endAt: instant(item.endAt)?.toISOString() ?? null,
          paid: item.paid === true,
        })).filter((item) => item.startAt) as BreakEntry[];
        let scheduledStartAt = instant(entry.scheduledStartAt);
        let scheduledEndAt = instant(entry.scheduledEndAt);
        let payable = Math.max(0, Math.min(1440, Math.floor(Number(entry.scheduledPayableMinutes ?? 0))));
        if (shiftId) {
          const [shift] = await tx.select().from(shifts).where(and(eq(shifts.id, shiftId), eq(shifts.userId, user.id))).limit(1);
          if (shift) { const window = shiftWindow(recordDate, shift.startTime, shift.endTime, timezone); scheduledStartAt = window.start; scheduledEndAt = window.end; payable = shift.payableMinutes; }
        }
        const result = user.category === "employee" ? calculateRecord({ startAt: rawStart, endAt: rawEnd, scheduledStartAt, scheduledEndAt, scheduledPayableMinutes: payable, breakEntries: breaks, overtimeOptions: shiftOvertimeOptions(user, {}, payable, status), status }) : calculateRecord({ startAt: rawStart, endAt: rawEnd, breakEntries: breaks, status });
        const requestedOvertimeStatus = ["pending", "approved", "rejected"].includes(stringValue(entry.overtimeStatus, 24)) ? stringValue(entry.overtimeStatus, 24) : "approved";
        const [created] = await tx.insert(attendanceRecords).values({
          userId: user.id,
          category: user.category,
          recordDate,
          status,
          subjectId,
          shiftId,
          projectId,
          scheduledStartAt,
          scheduledEndAt,
          scheduledPayableMinutes: payable,
          startAt: rawStart,
          endAt: rawEnd,
          breakEntries: breaks as JsonObject[],
          actualMinutes: result.actualMinutes,
          breakMinutes: result.breakMinutes,
          netMinutes: result.netMinutes,
          overtimeMinutes: user.category === "employee" ? result.overtimeMinutes : 0,
          overtimeStatus: requestedOvertimeStatus,
          overtimeMethod: result.overtimeMethod,
          overtimeCalculation: result.overtimeCalculation,
          note: stringValue(entry.note, 4000) || null,
          clientKey: sourceKey,
        }).returning();
        recordMap.set(oldId, created.id); addedRecords += 1;
      }
      for (const raw of sourceAudit) {
        const entry = object(raw);
        const oldAuditId = stringValue(entry.id, 64);
        const recordId = recordMap.get(stringValue(entry.recordId, 64));
        if (!oldAuditId || !recordId || user.category !== "employee") continue;
        const sourceKey = `restore:${sourceOwner}:${oldAuditId}`;
        const [existing] = await tx.select({ id: overtimeAudit.id }).from(overtimeAudit).where(and(eq(overtimeAudit.userId, user.id), eq(overtimeAudit.note, sourceKey))).limit(1);
        if (existing) continue;
        await tx.insert(overtimeAudit).values({ userId: user.id, recordId, action: stringValue(entry.action, 32) || "restored", calculation: object(entry.calculation) as JsonObject, note: sourceKey, createdAt: instant(entry.createdAt) ?? new Date() });
        addedAudit += 1;
      }
    });
    return json({ restored: { subjects: addedSubjects, shifts: addedShifts, projects: addedProjects, records: addedRecords, overtimeAudit: addedAudit }, message: "Backup data was restored into this account. Existing records were not duplicated." });
  }

  if (action === "data.export") {
    const [allRecords, allSubjects, allShifts, allProjects, allAudit] = await Promise.all([
      db.select().from(attendanceRecords).where(eq(attendanceRecords.userId, user.id)).orderBy(asc(attendanceRecords.recordDate)).limit(10000),
      db.select().from(subjects).where(eq(subjects.userId, user.id)).limit(500),
      db.select().from(shifts).where(eq(shifts.userId, user.id)).limit(200),
      db.select().from(projects).where(eq(projects.userId, user.id)).limit(500),
      db.select().from(overtimeAudit).where(eq(overtimeAudit.userId, user.id)).orderBy(asc(overtimeAudit.createdAt)).limit(10000),
    ]);
    return json({ exportedAt: new Date().toISOString(), user, records: allRecords, subjects: allSubjects, shifts: allShifts, projects: allProjects, overtimeAudit: allAudit });
  }

  return json({ error: "Unknown action." }, 400);
}
