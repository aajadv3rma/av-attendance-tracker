import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type JsonObject = Record<string, unknown>;

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash"),
    googleId: varchar("google_id", { length: 255 }),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    avatarUrl: text("avatar_url"),
    category: varchar("category", { length: 32 }).notNull().default("student"),
    timezone: varchar("timezone", { length: 80 }).notNull().default("Asia/Kolkata"),
    emailVerified: boolean("email_verified").notNull().default(false),
    profile: jsonb("profile").$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    preferences: jsonb("preferences").$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
    googleUnique: uniqueIndex("users_google_id_unique").on(table.googleId),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    userIndex: index("sessions_user_id_idx").on(table.userId),
  }),
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("auth_tokens_hash_unique").on(table.tokenHash),
    userIndex: index("auth_tokens_user_id_idx").on(table.userId),
  }),
);

export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 140 }).notNull(),
    code: varchar("code", { length: 48 }),
    teacher: varchar("teacher", { length: 140 }),
    targetPercent: integer("target_percent").notNull().default(75),
    schedule: jsonb("schedule").$type<Array<JsonObject>>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIndex: index("subjects_user_id_idx").on(table.userId),
  }),
);

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    startTime: varchar("start_time", { length: 8 }).notNull(),
    endTime: varchar("end_time", { length: 8 }).notNull(),
    payableMinutes: integer("payable_minutes").notNull().default(480),
    breakRules: jsonb("break_rules").$type<Array<JsonObject>>().notNull().default(sql`'[]'::jsonb`),
    weekdays: jsonb("weekdays").$type<number[]>().notNull().default(sql`'[1,2,3,4,5]'::jsonb`),
    overtimeRules: jsonb("overtime_rules").$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIndex: index("shifts_user_id_idx").on(table.userId),
  }),
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 140 }).notNull(),
    client: varchar("client", { length: 140 }),
    color: varchar("color", { length: 32 }).notNull().default("#3b7d68"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIndex: index("projects_user_id_idx").on(table.userId),
  }),
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 32 }).notNull(),
    recordDate: date("record_date").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("present"),
    subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
    scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
    scheduledPayableMinutes: integer("scheduled_payable_minutes").notNull().default(0),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    breakEntries: jsonb("break_entries").$type<Array<JsonObject>>().notNull().default(sql`'[]'::jsonb`),
    operationKeys: jsonb("operation_keys").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    breakMinutes: integer("break_minutes").notNull().default(0),
    actualMinutes: integer("actual_minutes").notNull().default(0),
    netMinutes: integer("net_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    overtimeStatus: varchar("overtime_status", { length: 24 }).notNull().default("approved"),
    overtimeMethod: varchar("overtime_method", { length: 48 }).notNull().default("scheduled-shift"),
    overtimeCalculation: jsonb("overtime_calculation").$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    note: text("note"),
    clientKey: varchar("client_key", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerDateIndex: index("attendance_user_date_idx").on(table.userId, table.recordDate),
    categoryDateIndex: index("attendance_user_category_date_idx").on(table.userId, table.category, table.recordDate),
    clientKeyUnique: uniqueIndex("attendance_user_client_key_unique").on(table.userId, table.clientKey),
    activeSessionUnique: uniqueIndex("attendance_one_active_session_per_category").on(table.userId, table.category).where(sql`${table.startAt} is not null and ${table.endAt} is null`),
  }),
);

export const overtimeAudit = pgTable(
  "overtime_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    recordId: uuid("record_id").notNull().references(() => attendanceRecords.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 32 }).notNull(),
    calculation: jsonb("calculation").$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIndex: index("overtime_audit_user_id_idx").on(table.userId, table.createdAt),
    recordIndex: index("overtime_audit_record_id_idx").on(table.recordId),
  }),
);

export const compOffLedger = pgTable(
  "comp_off_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    recordId: uuid("record_id").references(() => attendanceRecords.id, { onDelete: "set null" }),
    entryType: varchar("entry_type", { length: 16 }).notNull(),
    minutes: integer("minutes").notNull(),
    sourceMinutes: integer("source_minutes").notNull().default(0),
    sourceKey: varchar("source_key", { length: 160 }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceUnique: uniqueIndex("comp_off_user_source_unique").on(table.userId, table.sourceKey),
    ownerDateIndex: index("comp_off_user_date_idx").on(table.userId, table.createdAt),
    recordIndex: index("comp_off_record_id_idx").on(table.recordId),
  }),
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 48 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    message: text("message").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerDateIndex: index("notifications_user_date_idx").on(table.userId, table.createdAt),
  }),
);

export const attendanceTableDefinitions = {
  users,
  sessions,
  authTokens,
  subjects,
  shifts,
  projects,
  attendanceRecords,
  overtimeAudit,
  notifications,
};
