"use client";

import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, BriefcaseBusiness, CalendarDays, Check,
  CheckCircle2, ChevronLeft, ChevronRight, Clock3, Coffee, Edit3, Eye, FileSpreadsheet, Filter,
  GraduationCap, MoreHorizontal, Plus, Timer, Trash2, TrendingUp, UserRound, UsersRound, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { addDays, dateInTimezone, formatDuration, shiftWindow } from "@/lib/time";
import { calculateStudentTargets } from "@/lib/attendance";
import type { AttendanceRow, ProjectRow, ShiftRow, SubjectRow, WorkspaceData } from "./types";
import { asObject } from "./types";

type BaseViewProps = {
  data: WorkspaceData;
  onNavigate: (view: string) => void;
  onRecord: (record?: Partial<AttendanceRow>) => void;
  onAction: (action: string, payload?: Record<string, unknown>, queueable?: boolean) => Promise<unknown>;
  onDelete: (id: string) => void;
  onEditEntity: (kind: "subject" | "shift" | "project", item?: SubjectRow | ShiftRow | ProjectRow) => void;
};

const categoryStatus = (record: AttendanceRow) => record.status.replaceAll("-", " ");
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthStart(date: string) { return `${date.slice(0, 7)}-01`; }
function monthEnd(date: string) {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function prettyDate(date: string, timezone: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options }).format(new Date(`${date}T12:00:00.000Z`));
}
function timeOf(value: string | null, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function recordMinutes(record: AttendanceRow) {
  if (record.endAt || !record.startAt) return Math.max(0, record.netMinutes);
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(record.startAt).getTime()) / 60_000));
  const openBreak = record.breakEntries?.find((entry) => !entry.endAt && !entry.paid);
  const pause = openBreak ? Math.max(0, Math.floor((Date.now() - new Date(openBreak.startAt).getTime()) / 60_000)) : 0;
  return Math.max(0, elapsed - record.breakMinutes - pause);
}
function percent(attended: number, total: number) { return total === 0 ? 0 : Math.round((attended / total) * 100); }
function fullNameFirst(value: string) { return value.trim().split(/\s+/)[0] || "there"; }
function chartDayData(records: AttendanceRow[], timezone: string, category: string) {
  const today = dateInTimezone(new Date(), timezone);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    const daily = records.filter((record) => record.recordDate === date && record.status !== "cancelled");
    if (category === "student") return { day: prettyDate(date, timezone, { weekday: "short" }), Attended: daily.filter((record) => ["present", "late"].includes(record.status)).length, Missed: daily.filter((record) => record.status === "absent").length };
    return { day: prettyDate(date, timezone, { weekday: "short" }), Hours: Math.round(daily.reduce((total, record) => total + recordMinutes(record), 0) / 60 * 10) / 10, Overtime: Math.round(daily.filter((record) => record.overtimeStatus === "approved").reduce((total, record) => total + record.overtimeMinutes, 0) / 60 * 10) / 10 };
  });
}
function statusClass(status: string) {
  const key = status.toLowerCase().replaceAll(" ", "-");
  return `status-pill status-${key}`;
}
function EmptyState({ title, description, action, onClick }: { title: string; description: string; action?: string; onClick?: () => void }) {
  return <div className="empty-state"><span className="empty-state-icon"><CalendarDays size={18} /></span><strong>{title}</strong><p>{description}</p>{action && onClick && <button className="app-button app-button-primary" onClick={onClick}><Plus size={12} /> {action}</button>}</div>;
}
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number | string; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item) => <div key={item.name} style={{ color: item.color }}>{item.name}: {item.value}{item.name.includes("Hour") || item.name === "Hours" || item.name === "Overtime" ? "h" : ""}</div>)}</div>;
}
function statIcon(name: string) {
  if (name === "hours") return <Clock3 size={14} />;
  if (name === "target") return <TrendingUp size={14} />;
  if (name === "overtime") return <Timer size={14} />;
  if (name === "classes") return <BookOpen size={14} />;
  if (name === "days") return <CalendarDays size={14} />;
  if (name === "projects") return <BriefcaseBusiness size={14} />;
  return <Activity size={14} />;
}
function StatCard({ label, value, unit, foot, icon }: { label: string; value: string | number; unit?: string; foot: string; icon: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{statIcon(icon)}</span></div><strong>{value}<small>{unit}</small></strong><div className="stat-foot">{foot}</div></div>;
}

export function DashboardView({ data, onNavigate, onRecord, onAction }: BaseViewProps) {
  const user = data.user;
  const category = user.category;
  const today = dateInTimezone(new Date(), user.timezone);
  const thisMonth = today.slice(0, 7);
  const records = data.records.filter((record) => record.category === category);
  const todayRecords = records.filter((record) => record.recordDate === today);
  const activeRecord = [...records].filter((record) => record.startAt && !record.endAt).sort((a, b) => b.startAt!.localeCompare(a.startAt!))[0];
  const monthlyRecords = records.filter((record) => record.recordDate.startsWith(thisMonth));
  const weekRecords = records.filter((record) => record.recordDate >= addDays(today, -6) && record.recordDate <= today);
  const subjectFor = (id: string | null) => data.subjects.find((subject) => subject.id === id)?.name ?? "Class";
  const shiftFor = (id: string | null) => data.shifts.find((shift) => shift.id === id);
  const projectFor = (id: string | null) => data.projects.find((project) => project.id === id)?.name ?? "Focus session";
  const monthPresent = monthlyRecords.filter((record) => ["present", "late"].includes(record.status)).length;
  const monthConducted = monthlyRecords.filter((record) => !["cancelled", "excused"].includes(record.status)).length;
  const overallPresent = records.filter((record) => ["present", "late"].includes(record.status)).length;
  const overallConducted = records.filter((record) => !["cancelled", "excused"].includes(record.status)).length;
  const monthNet = monthlyRecords.reduce((total, record) => total + recordMinutes(record), 0) + (activeRecord?.recordDate.startsWith(thisMonth) ? recordMinutes(activeRecord) : 0);
  const approvedOvertime = monthlyRecords.filter((record) => record.overtimeStatus === "approved").reduce((total, record) => total + record.overtimeMinutes, 0);
  const pendingOvertime = monthlyRecords.filter((record) => record.overtimeStatus === "pending").reduce((total, record) => total + record.overtimeMinutes, 0);
  const uniqueWorkDays = new Set(monthlyRecords.filter((record) => record.netMinutes > 0 || record.startAt).map((record) => record.recordDate)).size;
  const chartData = useMemo(() => chartDayData(records, user.timezone, category), [records, user.timezone, category]);
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [calcTarget, setCalcTarget] = useState(75);
  const [calcSubjectId, setCalcSubjectId] = useState("");
  const [futureClasses, setFutureClasses] = useState(5);
  const greetingDate = new Intl.DateTimeFormat("en-US", { timeZone: user.timezone, weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const currentShift = activeRecord ? shiftFor(activeRecord.shiftId) : (selectedShiftId ? data.shifts.find((shift) => shift.id === selectedShiftId) : undefined) ?? data.shifts.find((shift) => shift.weekdays.includes(new Date(`${today}T12:00:00.000Z`).getUTCDay()));
  const currentProject = activeRecord ? data.projects.find((project) => project.id === activeRecord.projectId) : data.projects.find((project) => project.id === selectedProjectId) ?? data.projects.find((project) => project.active);
  const subjectStats = data.subjects.map((subject) => {
    const subjectRecords = records.filter((record) => record.subjectId === subject.id);
    const total = subjectRecords.filter((record) => !["cancelled", "excused"].includes(record.status)).length;
    const present = subjectRecords.filter((record) => ["present", "late"].includes(record.status)).length;
    return { subject, total, present, percent: percent(present, total) };
  });
  const calcStats = (() => {
    const subject = data.subjects.find((item) => item.id === calcSubjectId) ?? data.subjects[0];
    const subjectRecords = subject ? records.filter((record) => record.subjectId === subject.id) : records;
    const valid = subjectRecords.filter((record) => !["cancelled", "excused"].includes(record.status));
    const attended = valid.filter((record) => ["present", "late"].includes(record.status)).length;
    const current = calculateStudentTargets(attended, valid.length, calcTarget);
    const expected = valid.length + Math.max(0, futureClasses);
    const expectedPercent = expected ? Math.round(((attended + Math.max(0, futureClasses)) / expected) * 1000) / 10 : 0;
    return { subject, current, expectedPercent, future: Math.max(0, futureClasses) };
  })();
  const scheduleToday = data.subjects.flatMap((subject) => subject.schedule.filter((entry) => Number(entry.weekday ?? entry.day) === new Date(`${today}T12:00:00.000Z`).getUTCDay()).map((entry) => ({ subject, entry })));
  const recent = [...records].sort((a, b) => b.recordDate.localeCompare(a.recordDate) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const callAction = (action: string, payload: Record<string, unknown> = {}) => onAction(action, payload, true);
  const workingToday = todayRecords.reduce((sum, record) => sum + recordMinutes(record), 0) + (activeRecord?.recordDate === today ? recordMinutes(activeRecord) : 0);

  return <>
    <div className="page-heading"><div><h1>Overview</h1><p>Your time, at a glance.</p></div><div className="page-heading-actions"><button className="app-button" onClick={() => onNavigate("Calendar")}><CalendarDays size={13} /> Open calendar</button><button className="app-button app-button-primary" onClick={() => onRecord()}><Plus size={13} /> Add record</button></div></div>
    <section className="welcome-banner"><div className="welcome-copy"><span className="welcome-date">{greetingDate.toUpperCase()}</span><h2>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {fullNameFirst(user.fullName)}.</h2><p>{category === "student" ? "One class at a time. You’re building a clearer picture." : category === "employee" ? "Your shifts and hours, all in one place." : "Your work, on your schedule."}</p></div><div className="welcome-side"><div className="welcome-pill">THIS MONTH<strong>{category === "student" ? `${percent(monthPresent, monthConducted)}% attendance` : `${formatDuration(monthNet)} tracked`}</strong></div>{category === "employee" && <div className="welcome-pill">APPROVED OVERTIME<strong>{formatDuration(approvedOvertime)}</strong></div>}</div></section>
    <section className="stats-grid">
      {category === "student" ? <>
        <StatCard label="Attendance this month" value={`${percent(monthPresent, monthConducted)}%`} foot={`${monthPresent} attended of ${monthConducted} conducted`} icon="target" />
        <StatCard label="Classes attended" value={overallPresent} foot={`${overallConducted} classes counted`} icon="classes" />
        <StatCard label="Subjects" value={data.subjects.length} foot={data.subjects.length ? "Your active course list" : "Add your first subject"} icon="classes" />
        <StatCard label="Target" value={`${Math.round(calcStats.subject?.targetPercent ?? 75)}%`} foot={calcStats.subject?.name ?? "Your attendance goal"} icon="target" />
      </> : category === "employee" ? <>
        <StatCard label="Hours this month" value={Math.floor(monthNet / 60)} unit={`${String(monthNet % 60).padStart(2, "0")}m`} foot={`${uniqueWorkDays} recorded workdays`} icon="hours" />
        <StatCard label="Overtime · approved" value={formatDuration(approvedOvertime)} foot={`${formatDuration(pendingOvertime)} pending review`} icon="overtime" />
        <StatCard label="Workdays present" value={monthlyRecords.filter((record) => ["present", "late", "work-from-home"].includes(record.status)).length} foot={`${monthlyRecords.filter((record) => record.status === "late").length} late arrivals`} icon="days" />
        <StatCard label="Assigned shifts" value={data.shifts.length} foot={currentShift?.name ?? "Choose a shift to begin"} icon="hours" />
      </> : <>
        <StatCard label="Hours this month" value={Math.floor(monthNet / 60)} unit={`${String(monthNet % 60).padStart(2, "0")}m`} foot={`${uniqueWorkDays} active workdays`} icon="hours" />
        <StatCard label="Hours this week" value={Math.floor(weekRecords.reduce((sum, record) => sum + recordMinutes(record), 0) / 60)} foot="Across the last 7 days" icon="target" />
        <StatCard label="Projects" value={data.projects.length} foot="Organize your focus time" icon="projects" />
        <StatCard label="Today" value={formatDuration(workingToday)} foot={activeRecord ? "Session in progress" : "Ready when you are"} icon="hours" />
      </>}
    </section>

    <div className="content-grid">
      <div className="panel"><div className="panel-header"><div><h2>{category === "student" ? "Your attendance this week" : "Your week"}</h2><p>{category === "student" ? "Classes marked day by day" : "A steady look at your recorded time"}</p></div><button className="panel-link" onClick={() => onNavigate("Reports")}>View reports <ArrowRight size={12} /></button></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 4, right: 4, left: -23, bottom: 0 }} barGap={4}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="day" axisLine={false} tickLine={false} /><YAxis axisLine={false} tickLine={false} allowDecimals={false} /><Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(103,142,105,.07)" }} />{category === "student" ? <><Bar dataKey="Attended" fill="#6f956e" radius={[3, 3, 0, 0]} maxBarSize={18} /><Bar dataKey="Missed" fill="#d9a19a" radius={[3, 3, 0, 0]} maxBarSize={18} /></> : <><Bar dataKey="Hours" fill="#6f956e" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Overtime" fill="#92a7d0" radius={[3, 3, 0, 0]} maxBarSize={20} /></>}</BarChart></ResponsiveContainer></div></div>
      <div className="panel today-card"><div className="panel-header"><div><h2>{category === "student" ? "Today’s plan" : "Today"}</h2><p>{prettyDate(today, user.timezone, { weekday: "long", month: "long", day: "numeric" })}</p></div><span className="stat-icon"><Clock3 size={14} /></span></div>
        {category === "student" ? <>
          {scheduleToday.length > 0 ? scheduleToday.slice(0, 3).map(({ subject, entry }, index) => <div className="today-detail" key={`${subject.id}-${index}`}><span>{entry.startTime ?? "Class"} · {subject.name}</span><button className="app-button app-button-sm" onClick={() => onRecord({ recordDate: today, subjectId: subject.id, status: "present" })}>Mark</button></div>) : <div className="today-status"><span className="today-status-icon"><BookOpen size={14} /></span><div><strong>{data.subjects.length ? "No classes scheduled" : "Set up your subjects"}</strong><span>{data.subjects.length ? "Enjoy a little breathing room." : "Add subjects to start tracking."}</span></div></div>}
          <div className="quick-actions"><button className="app-button app-button-primary" onClick={() => onRecord({ recordDate: today, status: "present" })}><Plus size={12} /> Mark a class</button><button className="app-button" onClick={() => onNavigate("Subjects")}>View subjects</button></div>
        </> : <>
          <div className="today-status"><span className="today-status-icon">{activeRecord ? <Activity size={14} /> : <Clock3 size={14} />}</span><div><strong>{activeRecord ? "Your session is in progress" : "Ready to start?"}</strong><span>{activeRecord ? `Started ${timeOf(activeRecord.startAt, user.timezone)}` : currentShift?.name ?? (category === "employee" ? "Choose a shift below" : "Start a flexible session")}</span></div></div>
          {category === "employee" && !activeRecord && <div className="form-field" style={{ marginTop: 10 }}><label htmlFor="today-shift">Shift for today</label><select id="today-shift" value={selectedShiftId || currentShift?.id || ""} onChange={(event) => setSelectedShiftId(event.target.value)}><option value="">No shift (flexible)</option>{data.shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime} · {formatDuration(shift.payableMinutes)}</option>)}</select></div>}
          {category === "self-employed" && !activeRecord && data.projects.length > 0 && <div className="form-field" style={{ marginTop: 10 }}><label htmlFor="today-project">Project</label><select id="today-project" value={selectedProjectId || currentProject?.id || ""} onChange={(event) => setSelectedProjectId(event.target.value)}><option value="">Personal / unassigned</option>{data.projects.filter((project) => project.active).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>}
          <div className="today-detail"><span>Time recorded today</span><strong>{formatDuration(workingToday)}</strong></div>
          {category === "employee" && <div className="today-detail"><span>Overtime today</span><strong>{formatDuration(todayRecords.filter((record) => record.overtimeStatus === "approved").reduce((sum, record) => sum + record.overtimeMinutes, 0))}</strong></div>}
          {activeRecord && activeRecord.breakEntries.some((entry) => !entry.endAt) && <div className="today-detail"><span>Break in progress</span><strong><Coffee size={12} /></strong></div>}
          <div className="quick-actions">{!activeRecord ? <button className="app-button app-button-primary" onClick={() => callAction("attendance.clock-in", { shiftId: category === "employee" ? selectedShiftId || currentShift?.id : undefined, projectId: category === "self-employed" ? selectedProjectId || currentProject?.id : undefined, requestId: crypto.randomUUID() })}><Clock3 size={12} /> Start work</button> : <>{activeRecord.breakEntries.some((entry) => !entry.endAt) ? <button className="app-button" onClick={() => callAction("attendance.break-end", { recordId: activeRecord.id, requestId: crypto.randomUUID() })}><Check size={12} /> End break</button> : <button className="app-button" onClick={() => callAction("attendance.break-start", { recordId: activeRecord.id, requestId: crypto.randomUUID(), label: "Break" })}><Coffee size={12} /> Start break</button>}<button className="app-button app-button-primary" onClick={() => callAction("attendance.clock-out", { recordId: activeRecord.id, requestId: crypto.randomUUID() })}><CheckCircle2 size={12} /> End work</button></>}</div>
        </>}
      </div>
    </div>

    {category === "student" && <div className="calc-card" style={{ marginTop: 12 }}><div className="panel-header"><div><h3>Attendance goal calculator</h3><p>See how future classes could move your percentage. Cancelled and excused classes are not counted.</p></div><span className="stat-icon"><TrendingUp size={14} /></span></div>{data.subjects.length > 0 ? <><div className="calc-input-row"><div className="form-field"><label htmlFor="calc-subject">Subject</label><select id="calc-subject" value={calcSubjectId || data.subjects[0]?.id} onChange={(event) => setCalcSubjectId(event.target.value)}>{data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></div><div className="form-field"><label htmlFor="calc-target">Target percentage</label><input id="calc-target" type="number" min={1} max={100} value={calcTarget} onChange={(event) => setCalcTarget(Math.max(1, Math.min(100, Number(event.target.value) || 75)))} /></div><div className="form-field"><label htmlFor="calc-future">Upcoming classes</label><input id="calc-future" type="number" min={0} max={100} value={futureClasses} onChange={(event) => setFutureClasses(Math.max(0, Number(event.target.value) || 0))} /></div></div><div className="calc-result"><div><span>Current attendance</span><strong>{calcStats.current.percentage}%</strong></div><div><span>More classes to attend to reach target</span><strong>{calcStats.current.requiredToReach === Number.POSITIVE_INFINITY ? "Not possible" : calcStats.current.requiredToReach}</strong></div><div><span>If you attend all upcoming</span><strong>{calcStats.expectedPercent}%</strong></div></div></> : <EmptyState title="Add a subject to calculate" description="The calculator uses real class records for each subject." action="Add a subject" onClick={() => onNavigate("Subjects")} />}</div>}

    {category === "student" && <div className="panel" style={{ marginTop: 12 }}><div className="panel-header"><div><h2>Subject attendance</h2><p>Only marked, non-cancelled class records are included.</p></div><button className="panel-link" onClick={() => onNavigate("Subjects")}>Manage subjects <ArrowRight size={12} /></button></div>{subjectStats.length ? <div className="subject-grid">{subjectStats.slice(0, 3).map(({ subject, total, present, percent: progress }) => <div className="entity-card" key={subject.id}><div className="entity-card-top"><div><h3>{subject.name}</h3><p>{subject.code || subject.teacher || "Subject"}</p></div><strong>{progress}%</strong></div><div className="target-progress"><i style={{ width: `${Math.min(100, progress)}%` }} /></div><div className="entity-meta"><span>{present} attended · {total} counted</span><span>Target {subject.targetPercent}%</span></div></div>)}</div> : <EmptyState title="Your subjects will appear here" description="Add a subject to begin following attendance by course." action="Add subject" onClick={() => onNavigate("Subjects")} />}</div>}

    <div className="panel recent-panel"><div className="panel-header"><div><h2>Recent activity</h2><p>Your latest recorded classes and work sessions</p></div><button className="panel-link" onClick={() => onNavigate("Attendance")}>Full history <ArrowRight size={12} /></button></div>{recent.length ? <div className="recent-list">{recent.map((record) => <div className="recent-row" key={record.id}><span className="recent-icon">{category === "student" ? <BookOpen size={12} /> : category === "employee" ? <Clock3 size={12} /> : <BriefcaseBusiness size={12} />}</span><div><strong>{category === "student" ? subjectFor(record.subjectId) : category === "employee" ? shiftFor(record.shiftId)?.name ?? "Work session" : projectFor(record.projectId)}</strong><span>{prettyDate(record.recordDate, user.timezone, { month: "short", day: "numeric", year: "numeric" })}{record.startAt ? ` · ${timeOf(record.startAt, user.timezone)}` : ""}{record.note ? ` · ${record.note}` : ""}</span></div><span className="recent-time">{record.netMinutes ? formatDuration(record.netMinutes) : ""}</span><span className={statusClass(record.status)}>{categoryStatus(record)}</span></div>)}</div> : <EmptyState title="Nothing recorded yet" description={category === "student" ? "Mark your first class to start building your attendance history." : "Start a work session or add a manual entry to begin."} action={category === "student" ? "Mark a class" : "Start / add work"} onClick={() => category === "student" ? onRecord({ recordDate: today, status: "present" }) : onRecord({ recordDate: today })} />}</div>
  </>;
}

export function AttendanceView({ data, onRecord, onDelete, onNavigate }: BaseViewProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const user = data.user;
  const rows = data.records.filter((record) => record.category === user.category).filter((record) => statusFilter === "all" || record.status === statusFilter).filter((record) => monthFilter === "all" || record.recordDate.startsWith(monthFilter)).filter((record) => subjectFilter === "all" || record.subjectId === subjectFilter).filter((record) => {
    if (!search.trim()) return true;
    const subject = data.subjects.find((item) => item.id === record.subjectId)?.name ?? "";
    const shift = data.shifts.find((item) => item.id === record.shiftId)?.name ?? "";
    const project = data.projects.find((item) => item.id === record.projectId)?.name ?? "";
    return `${subject} ${shift} ${project} ${record.note ?? ""} ${record.status} ${record.recordDate}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => b.recordDate.localeCompare(a.recordDate) || b.createdAt.localeCompare(a.createdAt));
  return <>
    <div className="page-heading"><div><h1>Attendance history</h1><p>Review and update your saved attendance and work sessions.</p></div><div className="page-heading-actions">{user.category === "student" && <button className="app-button" onClick={() => onNavigate("Bulk mark")}><Check size={12} /> Bulk mark</button>}<button className="app-button app-button-primary" onClick={() => onRecord()}><Plus size={13} /> Manual entry</button></div></div>
    <div className="panel table-panel"><div className="table-toolbar"><div className="filter-row"><input aria-label="Search attendance" placeholder="Search records…" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="filter-control" aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{Array.from(new Set(data.records.map((record) => record.status))).map((status) => <option key={status} value={status}>{categoryStatus({ status } as AttendanceRow)}</option>)}</select><select className="filter-control" aria-label="Filter by month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}><option value="all">All months</option>{Array.from(new Set(data.records.map((record) => record.recordDate.slice(0, 7)))).sort().reverse().map((month) => <option key={month} value={month}>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: user.timezone }).format(new Date(`${month}-15T12:00:00Z`))}</option>)}</select>{user.category === "student" && <select className="filter-control" aria-label="Filter by subject" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="all">All subjects</option>{data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>}</div><span className="form-hint">{rows.length} record{rows.length === 1 ? "" : "s"}</span></div>
      {rows.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>{user.category === "student" ? "Subject" : user.category === "employee" ? "Shift" : "Project"}</th><th>Status</th><th>{user.category === "student" ? "Attendance" : "Start / end"}</th><th>Hours</th>{user.category === "employee" && <th>Overtime</th>}<th>Note</th><th>Actions</th></tr></thead><tbody>{rows.map((record) => <tr key={record.id}><td>{prettyDate(record.recordDate, user.timezone, { month: "short", day: "numeric", year: "numeric" })}</td><td>{user.category === "student" ? data.subjects.find((subject) => subject.id === record.subjectId)?.name ?? "—" : user.category === "employee" ? data.shifts.find((shift) => shift.id === record.shiftId)?.name ?? "Work session" : data.projects.find((project) => project.id === record.projectId)?.name ?? "Personal"}{user.category === "employee" && record.shiftId && <small>{data.shifts.find((shift) => shift.id === record.shiftId)?.startTime}–{data.shifts.find((shift) => shift.id === record.shiftId)?.endTime}</small>}</td><td><span className={statusClass(record.status)}>{categoryStatus(record)}</span></td><td>{user.category === "student" ? "—" : <>{timeOf(record.startAt, user.timezone)}{record.endAt ? ` – ${timeOf(record.endAt, user.timezone)}` : record.startAt ? " · in progress" : ""}</>}</td><td>{record.netMinutes ? formatDuration(record.netMinutes) : "—"}</td>{user.category === "employee" && <td>{record.overtimeMinutes ? <><strong>{formatDuration(record.overtimeMinutes)}</strong><small>{record.overtimeStatus}</small></> : "—"}</td>}<td title={record.note ?? undefined}>{record.note || "—"}</td><td><div className="table-actions"><button className="table-icon-button" aria-label="Edit record" title="Edit record" onClick={() => onRecord(record)}><Edit3 size={12} /></button><button className="table-icon-button danger" aria-label="Delete record" title="Delete record" onClick={() => onDelete(record.id)}><Trash2 size={12} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState title="No matching records" description="Try another filter or add your first attendance entry." action="Add entry" onClick={() => onRecord()} />}</div>
    {data.truncated && <p className="form-hint" style={{ marginTop: 10 }}>This view is limited to the latest 500 records. Use data export in Settings for a full backup.</p>}
  </>;
}

export function CalendarView({ data, onRecord }: BaseViewProps) {
  const today = dateInTimezone(new Date(), data.user.timezone);
  const [visibleMonth, setVisibleMonth] = useState(monthStart(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const [filter, setFilter] = useState("all");
  const [viewMode, setViewMode] = useState("month");
  const year = Number(visibleMonth.slice(0, 4));
  const month = Number(visibleMonth.slice(5, 7));
  const firstWeekday = new Date(`${visibleMonth}T12:00:00.000Z`).getUTCDay();
  const firstCell = addDays(visibleMonth, -((firstWeekday + 6) % 7));
  const selectedWeekStart = addDays(selectedDay, -((new Date(`${selectedDay}T12:00:00.000Z`).getUTCDay() + 6) % 7));
  const days = Array.from({ length: viewMode === "day" ? 1 : viewMode === "week" ? 7 : 42 }, (_, index) => addDays(viewMode === "day" ? selectedDay : viewMode === "week" ? selectedWeekStart : firstCell, index));
  const selectedRecords = data.records.filter((record) => record.recordDate === selectedDay && (filter === "all" || record.status === filter));
  const grouped = new Map<string, AttendanceRow[]>();
  data.records.forEach((record) => { if (filter === "all" || record.status === filter) grouped.set(record.recordDate, [...(grouped.get(record.recordDate) ?? []), record]); });
  const currentLabel = viewMode === "day"
    ? prettyDate(selectedDay, data.user.timezone, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : viewMode === "week"
      ? `${prettyDate(selectedWeekStart, data.user.timezone)} – ${prettyDate(addDays(selectedWeekStart, 6), data.user.timezone, { month: "short", day: "numeric", year: "numeric" })}`
      : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: data.user.timezone }).format(new Date(`${visibleMonth}-15T12:00:00Z`));
  const moveMonth = (amount: number) => {
    if (viewMode === "day") { const next = addDays(selectedDay, amount); setSelectedDay(next); setVisibleMonth(monthStart(next)); return; }
    if (viewMode === "week") { const next = addDays(selectedDay, amount * 7); setSelectedDay(next); setVisibleMonth(monthStart(next)); return; }
    const date = new Date(Date.UTC(year, month - 1 + amount, 1));
    setVisibleMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`);
  };
  return <>
    <div className="page-heading"><div><h1>Calendar</h1><p>Browse your attendance by date, and open a day for the details.</p></div><div className="page-heading-actions"><select className="filter-control" value={filter} aria-label="Filter calendar by status" onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option>{Array.from(new Set(data.records.map((record) => record.status))).map((status) => <option key={status} value={status}>{status.replaceAll("-", " ")}</option>)}</select><button className="app-button app-button-primary" onClick={() => onRecord({ recordDate: selectedDay })}><Plus size={12} /> Add on {prettyDate(selectedDay, data.user.timezone)}</button></div></div>
    <div className="panel calendar-panel"><div className="calendar-head"><div style={{ display: "flex", alignItems: "center", gap: 11 }}><strong>{currentLabel}</strong><button className="app-button app-button-sm" onClick={() => { setVisibleMonth(monthStart(today)); setSelectedDay(today); }}>Today</button></div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><select className="filter-control" value={viewMode} onChange={(event) => setViewMode(event.target.value)} aria-label="Calendar view"><option value="month">Month</option><option value="week">Week</option><option value="day">Day</option></select><div className="calendar-nav"><button className="icon-button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={14} /></button><button className="icon-button" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight size={14} /></button></div></div></div>
      {viewMode !== "day" && <div className="calendar-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>}<div className="calendar-days" style={viewMode === "day" ? { gridTemplateColumns: "1fr" } : undefined}>{days.map((date) => { const entries = grouped.get(date) ?? []; const d = Number(date.slice(-2)); const outside = date.slice(0, 7) !== visibleMonth.slice(0, 7); return <button key={date} className={`calendar-day ${outside ? "outside" : ""} ${date === today ? "today" : ""} ${date === selectedDay ? "selected" : ""}`} onClick={() => { setSelectedDay(date); setVisibleMonth(monthStart(date)); }} aria-label={`${prettyDate(date, data.user.timezone, { month: "long", day: "numeric", year: "numeric" })}, ${entries.length} records`}><span className="calendar-date">{d}</span>{entries.length > 0 && <><div className="calendar-dot-row">{entries.slice(0, 4).map((record, index) => <i key={index} className={`calendar-dot ${record.status === "absent" ? "absent" : record.status === "late" ? "late" : record.overtimeMinutes > 0 ? "overtime" : ""}`} />)}</div><div className="calendar-day-note">{entries.length} {entries.length === 1 ? "entry" : "entries"}{entries.some((record) => record.overtimeMinutes > 0) ? " · overtime" : ""}</div></>}</button>; })}</div>
      <div className="calendar-detail"><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><h3>{prettyDate(selectedDay, data.user.timezone, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h3><button className="app-button app-button-sm" onClick={() => onRecord({ recordDate: selectedDay })}><Plus size={11} /> Add record</button></div>{selectedRecords.length ? selectedRecords.map((record) => { const label = data.user.category === "student" ? data.subjects.find((subject) => subject.id === record.subjectId)?.name ?? "Class" : data.user.category === "employee" ? data.shifts.find((shift) => shift.id === record.shiftId)?.name ?? "Work session" : data.projects.find((project) => project.id === record.projectId)?.name ?? "Personal work"; return <div className="calendar-detail-row" key={record.id}><span>{label} · {categoryStatus(record)}{record.startAt ? ` · ${timeOf(record.startAt, data.user.timezone)}${record.endAt ? `–${timeOf(record.endAt, data.user.timezone)}` : " (active)"}` : ""}</span><strong>{record.netMinutes ? formatDuration(record.netMinutes) : ""}{record.overtimeMinutes ? ` · ${formatDuration(record.overtimeMinutes)} OT` : ""}</strong></div>; }) : <p className="form-hint">No entries for this date. Use “Add record” to create one.</p>}</div>
    </div>
  </>;
}

export function EntityView({ data, onEditEntity, onAction, onDelete }: BaseViewProps) {
  const category = data.user.category;
  if (category === "student") {
    const records = data.records.filter((record) => record.category === "student");
    return <><div className="page-heading"><div><h1>Subjects</h1><p>Manage courses, weekly class schedules, and individual attendance goals.</p></div><button className="app-button app-button-primary" onClick={() => onEditEntity("subject")}><Plus size={13} /> Add subject</button></div>{data.subjects.length ? <div className="subject-grid">{data.subjects.map((subject) => { const entries = records.filter((record) => record.subjectId === subject.id && !["cancelled", "excused"].includes(record.status)); const present = entries.filter((record) => ["present", "late"].includes(record.status)).length; const rate = percent(present, entries.length); return <div className="entity-card" key={subject.id}><div className="entity-card-top"><div><h3>{subject.name}</h3><p>{[subject.code, subject.teacher].filter(Boolean).join(" · ") || "Subject details"}</p></div><button className="table-icon-button" aria-label={`Edit ${subject.name}`} onClick={() => onEditEntity("subject", subject)}><Edit3 size={12} /></button></div><div className="target-progress"><i style={{ width: `${Math.min(100, rate)}%` }} /></div><div className="entity-meta"><span>{present} / {entries.length} counted</span><strong>{rate}% <small>· target {subject.targetPercent}%</small></strong></div>{subject.schedule.length > 0 && <div className="entity-meta"><span>Weekly schedule</span><span>{subject.schedule.map((entry) => `${dayNames[Number(entry.weekday ?? entry.day) % 7]} ${entry.startTime ?? ""}`).join(" · ")}</span></div>}<div className="entity-meta"><span>{rate >= subject.targetPercent ? "On target" : `${subject.targetPercent - rate}% to target`}</span><button className="table-icon-button danger" aria-label={`Delete ${subject.name}`} onClick={() => onDelete(subject.id)}><Trash2 size={12} /></button></div></div>; })}</div> : <div className="panel"><EmptyState title="Start with a subject" description="Add each course you want to track. Subjects can have their own target and weekly lecture schedule." action="Add subject" onClick={() => onEditEntity("subject")} /></div>}</>;
  }
  if (category === "employee") return <><div className="page-heading"><div><h1>Shifts</h1><p>Create fixed, rotating, and overnight shifts. Payable hours are separate from elapsed shift duration.</p></div><button className="app-button app-button-primary" onClick={() => onEditEntity("shift")}><Plus size={13} /> Create shift</button></div>{data.shifts.length ? <div className="subject-grid">{data.shifts.map((shift) => <ShiftCard key={shift.id} shift={shift} onEdit={() => onEditEntity("shift", shift)} onDelete={() => onDelete(shift.id)} />)}</div> : <div className="panel"><EmptyState title="No shifts configured" description="Create a shift to calculate scheduled hours, lateness, and overtime correctly." action="Create shift" onClick={() => onEditEntity("shift")} /></div>}<div className="panel" style={{ marginTop: 12 }}><div className="panel-header"><div><h2>Overnight shift handling</h2><p>End times that are earlier than or equal to a shift start are placed on the next local calendar day.</p></div><span className="stat-icon"><Clock3 size={14} /></span></div><p className="form-hint">For example, 23:00–07:00 on November 2 is stored as one continuous window ending November 3. Payable hours remain configurable independently.</p></div></>;
  return <><div className="page-heading"><div><h1>Projects</h1><p>Organize flexible work sessions by client or project.</p></div><button className="app-button app-button-primary" onClick={() => onEditEntity("project")}><Plus size={13} /> Add project</button></div>{data.projects.length ? <div className="project-grid">{data.projects.map((project) => { const minutes = data.records.filter((record) => record.projectId === project.id).reduce((total, record) => total + recordMinutes(record), 0); return <div className="entity-card" key={project.id}><div className="entity-card-top"><div style={{ display: "flex", gap: 9, alignItems: "center" }}><span style={{ width: 10, height: 10, display: "inline-block", borderRadius: 3, background: project.color }} /><div><h3>{project.name}</h3><p>{project.client || "Personal project"}</p></div></div><button className="table-icon-button" aria-label={`Edit ${project.name}`} onClick={() => onEditEntity("project", project)}><Edit3 size={12} /></button></div><div className="entity-meta"><span>{project.active ? "Active" : "Archived"}</span><strong>{formatDuration(minutes)}</strong></div><div className="entity-meta"><span>Tracked time</span><button className="table-icon-button danger" aria-label={`Delete ${project.name}`} onClick={() => onDelete(project.id)}><Trash2 size={12} /></button></div></div>; })}</div> : <div className="panel"><EmptyState title="A place for your projects" description="Add projects or clients, then choose one when you start a work session." action="Add project" onClick={() => onEditEntity("project")} /></div>}<div className="panel" style={{ marginTop: 12 }}><div className="panel-header"><div><h2>Flexible by design</h2><p>Track sessions without needing a fixed shift or workday.</p></div><span className="stat-icon"><BriefcaseBusiness size={14} /></span></div><p className="form-hint">Set daily, weekly, and monthly personal targets in Settings. Rest days and personal holidays stay separate from work time.</p></div></>;
}

function ShiftCard({ shift, onEdit, onDelete }: { shift: ShiftRow; onEdit: () => void; onDelete: () => void }) {
  return <div className="entity-card"><div className="entity-card-top"><div><h3>{shift.name}</h3><p>{shift.startTime} – {shift.endTime}{shift.endTime <= shift.startTime ? " · overnight" : ""}</p></div><button className="table-icon-button" aria-label={`Edit ${shift.name}`} onClick={onEdit}><Edit3 size={12} /></button></div><div className="entity-meta"><span>Scheduled payable</span><strong>{formatDuration(shift.payableMinutes)}</strong></div><div className="entity-meta"><span>Workdays</span><span>{shift.weekdays.map((day) => dayNames[day]).join(", ") || "Not assigned"}</span></div><div className="entity-meta"><span>Breaks configured</span><span>{shift.breakRules.length}</span></div><div className="entity-meta"><span>Overtime</span><span>{String(shift.overtimeRules.method ?? "scheduled-shift").replaceAll("-", " ")}</span><button className="table-icon-button danger" aria-label={`Delete ${shift.name}`} onClick={onDelete}><Trash2 size={12} /></button></div></div>;
}

export function OvertimeView({ data, onAction, onRecord, onNavigate }: BaseViewProps) {
  const [filterStatus, setFilterStatus] = useState("all");
  const [period, setPeriod] = useState("month");
  const [hourlyRate, setHourlyRate] = useState(Number(asObject(asObject(data.user.preferences).employee).hourlyRate ?? 0));
  const [multiplier, setMultiplier] = useState(Number(asObject(asObject(data.user.preferences).employee).overtimeMultiplier ?? 1.5));
  const [showEarnings, setShowEarnings] = useState(Boolean(asObject(asObject(data.user.preferences).employee).earningsEnabled));
  const today = dateInTimezone(new Date(), data.user.timezone);
  const start = period === "week" ? addDays(today, -6) : period === "year" ? `${today.slice(0, 4)}-01-01` : period === "all" ? "0001-01-01" : `${today.slice(0, 7)}-01`;
  const records = data.records.filter((record) => record.category === "employee" && record.overtimeMinutes > 0 && record.recordDate >= start).filter((record) => filterStatus === "all" || record.overtimeStatus === filterStatus).sort((a, b) => b.recordDate.localeCompare(a.recordDate));
  const allPeriodRecords = data.records.filter((record) => record.category === "employee" && record.recordDate >= start);
  const minutes = (status?: string) => allPeriodRecords.filter((record) => !status || record.overtimeStatus === status).reduce((total, record) => total + record.overtimeMinutes, 0);
  const pending = allPeriodRecords.filter((record) => record.overtimeStatus === "pending").length;
  const approvedMinutes = minutes("approved");
  const estimate = Math.round((approvedMinutes / 60) * Math.max(0, hourlyRate) * Math.max(0, multiplier) * 100) / 100;
  const monthlyChart = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - (5 - index), 1));
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const group = data.records.filter((record) => record.category === "employee" && record.recordDate.startsWith(month));
    return { month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: data.user.timezone }).format(date), Approved: Math.round(group.filter((record) => record.overtimeStatus === "approved").reduce((sum, record) => sum + record.overtimeMinutes, 0) / 60 * 10) / 10, Pending: Math.round(group.filter((record) => record.overtimeStatus === "pending").reduce((sum, record) => sum + record.overtimeMinutes, 0) / 60 * 10) / 10 };
  });
  if (data.user.category !== "employee") return <div className="panel"><EmptyState title="Overtime is for employee shift accounts" description="Create an employee workspace to configure shifts and overtime rules." /></div>;
  return <>
    <div className="page-heading"><div><h1>Overtime</h1><p>A clear history of your extra time, status, and how each total was calculated.</p></div><div className="page-heading-actions"><select className="filter-control" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Overtime reporting period"><option value="week">Last 7 days</option><option value="month">This month</option><option value="year">This year</option><option value="all">All time</option></select><button className="app-button" onClick={() => onNavigate("Settings")}><Filter size={12} /> Rules & rates</button></div></div>
    <div className="overtime-grid"><StatCard label="Overtime tracked" value={formatDuration(minutes())} foot="All statuses in selected period" icon="overtime" /><StatCard label="Approved" value={formatDuration(approvedMinutes)} foot="Only approved time is included" icon="target" /><StatCard label="Pending" value={formatDuration(minutes("pending"))} foot={`${pending} record${pending === 1 ? "" : "s"} awaiting review`} icon="hours" /><StatCard label="Rejected" value={formatDuration(minutes("rejected"))} foot="Kept in history, not earnings" icon="days" /></div>
    <div className="overtime-layout"><div className="panel"><div className="panel-header"><div><h2>Overtime history</h2><p>Scheduled and actual time, with current review status.</p></div><select className="filter-control" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} aria-label="Filter overtime status"><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>{records.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date / shift</th><th>Scheduled</th><th>Actual net</th><th>Extra time</th><th>Status</th><th>Details</th></tr></thead><tbody>{records.map((record) => { const shift = data.shifts.find((item) => item.id === record.shiftId); return <tr key={record.id}><td>{prettyDate(record.recordDate, data.user.timezone, { month: "short", day: "numeric", year: "numeric" })}<small>{shift?.name ?? "Manual record"}</small></td><td>{record.scheduledStartAt ? `${timeOf(record.scheduledStartAt, data.user.timezone)}–${timeOf(record.scheduledEndAt, data.user.timezone)}` : formatDuration(record.scheduledPayableMinutes)}<small>{formatDuration(record.scheduledPayableMinutes)} payable</small></td><td>{formatDuration(record.netMinutes)}<small>{record.breakMinutes ? `${formatDuration(record.breakMinutes)} unpaid break` : "No unpaid break"}</small></td><td><strong>{formatDuration(record.overtimeMinutes)}</strong><small>{record.overtimeMethod.replaceAll("-", " ")}</small></td><td><span className={statusClass(record.overtimeStatus)}>{record.overtimeStatus}</span></td><td><div className="table-actions"><button className="table-icon-button" title="Edit attendance" aria-label="Edit attendance" onClick={() => onRecord(record)}><Edit3 size={12} /></button>{record.overtimeStatus === "pending" && <><button className="table-icon-button" title="Approve overtime" aria-label="Approve overtime" onClick={() => onAction("overtime.status", { id: record.id, status: "approved" })}><Check size={12} /></button><button className="table-icon-button danger" title="Reject overtime" aria-label="Reject overtime" onClick={() => onAction("overtime.status", { id: record.id, status: "rejected", note: "Rejected from personal overtime review." })}><X size={12} /></button></>}</div></td></tr>; })}</tbody></table></div> : <EmptyState title="No overtime in this period" description="Completed employee attendance is compared with the scheduled payable duration and your eligibility rules." action="Review rules" onClick={() => onNavigate("Settings")} />}</div>
      <div><div className="panel"><div className="panel-header"><div><h2>Overtime trend</h2><p>Approved and pending, by month</p></div><span className="stat-icon"><TrendingUp size={14} /></span></div><div className="chart-wrap" style={{ height: 185 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyChart} margin={{ top: 5, right: 3, left: -23, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="month" axisLine={false} tickLine={false} /><YAxis axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="Approved" fill="#6f956e" radius={[3, 3, 0, 0]} maxBarSize={18} /><Bar dataKey="Pending" fill="#d0af72" radius={[3, 3, 0, 0]} maxBarSize={18} /></BarChart></ResponsiveContainer></div></div>
        <div className="panel" style={{ marginTop: 11 }}><div className="panel-header"><div><h2>Estimated earnings</h2><p>Optional estimate · not payroll advice</p></div><span className="stat-icon"><ArrowUpRight size={14} /></span></div><label className="form-check-row"><input type="checkbox" checked={showEarnings} onChange={(event) => setShowEarnings(event.target.checked)} /> Enable earnings estimate</label>{showEarnings && <><div className="form-field" style={{ marginTop: 10 }}><label htmlFor="hourly-rate">Hourly rate</label><input id="hourly-rate" type="number" min="0" step="0.01" value={hourlyRate} onChange={(event) => setHourlyRate(Math.max(0, Number(event.target.value) || 0))} /></div><div className="form-field" style={{ marginTop: 8 }}><label htmlFor="multiplier">Overtime multiplier</label><select id="multiplier" value={multiplier} onChange={(event) => setMultiplier(Number(event.target.value))}><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option><option value="2.5">2.5×</option><option value="3">3×</option></select></div><div className="earnings-result"><small>ESTIMATE ON APPROVED OVERTIME</small><strong>{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(estimate)}</strong><span>{(approvedMinutes / 60).toFixed(2)} approved hours × ₹{hourlyRate.toFixed(2)} × {multiplier}×. A personal estimate only; not an official payroll calculation.</span></div><button className="app-button app-button-sm" style={{ marginTop: 8 }} onClick={() => onAction("settings.save", { preferences: { employee: { ...asObject(asObject(data.user.preferences).employee), earningsEnabled: showEarnings, hourlyRate, overtimeMultiplier: multiplier } } })}>Save estimate settings</button></>}</div></div>
    </div>
    <div className="panel" style={{ marginTop: 12 }}><div className="panel-header"><div><h2>How an overtime total is formed</h2><p>Each record keeps its own calculation snapshot.</p></div><span className="stat-icon"><Eye size={14} /></span></div><div className="breakdown-line"><span>Eligible actual time</span><strong>Actual session − unpaid break time</strong></div><div className="breakdown-line"><span>Scheduled payable time</span><strong>Configured separately from shift length</strong></div><div className="breakdown-line"><span>Overtime</span><strong>Eligible time above the selected threshold, rounded by your rule</strong></div><p className="form-hint" style={{ marginTop: 10 }}>Early arrival is excluded unless enabled. Weekly-threshold mode allocates minutes chronologically and is exclusive of daily shift overtime, preventing double counting. Open a record in attendance history to review its saved calculation.</p></div>
  </>;
}

export function ReportsView({ data, onAction }: BaseViewProps) {
  const [range, setRange] = useState("month");
  const [from, setFrom] = useState(dateInTimezone(new Date(), data.user.timezone).slice(0, 7) + "-01");
  const [through, setThrough] = useState(dateInTimezone(new Date(), data.user.timezone));
  const today = dateInTimezone(new Date(), data.user.timezone);
  const bounds = (() => {
    if (range === "day") return { start: today, end: today };
    if (range === "week") return { start: addDays(today, -6), end: today };
    if (range === "year") return { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` };
    if (range === "custom") return { start: from, end: through };
    return { start: `${today.slice(0, 7)}-01`, end: monthEnd(today) };
  })();
  const rows = data.records.filter((record) => record.category === data.user.category && record.recordDate >= bounds.start && record.recordDate <= bounds.end).sort((a, b) => a.recordDate.localeCompare(b.recordDate));
  const isStudent = data.user.category === "student";
  const studentConducted = rows.filter((record) => !["cancelled", "excused"].includes(record.status));
  const present = rows.filter((record) => ["present", "late"].includes(record.status)).length;
  const totalHours = rows.reduce((sum, record) => sum + recordMinutes(record), 0);
  const approvedOT = rows.filter((record) => record.overtimeStatus === "approved").reduce((sum, record) => sum + record.overtimeMinutes, 0);
  const csvEscape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const downloadCsv = () => {
    const headers = isStudent ? ["Date", "Subject", "Status", "Note"] : ["Date", data.user.category === "employee" ? "Shift" : "Project", "Status", "Start", "End", "Actual minutes", "Break minutes", "Net minutes", "Overtime minutes", "Overtime status", "Note"];
    const lines = [headers.map(csvEscape).join(","), ...rows.map((record) => {
      const label = isStudent ? data.subjects.find((item) => item.id === record.subjectId)?.name : data.user.category === "employee" ? data.shifts.find((item) => item.id === record.shiftId)?.name : data.projects.find((item) => item.id === record.projectId)?.name;
      const values = isStudent ? [record.recordDate, label, record.status, record.note] : [record.recordDate, label, record.status, record.startAt, record.endAt, record.actualMinutes, record.breakMinutes, record.netMinutes, record.overtimeMinutes, record.overtimeStatus, record.note];
      return values.map(csvEscape).join(",");
    })];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `av-attendance-${bounds.start}-to-${bounds.end}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const downloadJson = async () => {
    const response = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ action: "data.export" }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not export your data.");
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `av-attendance-backup-${today}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const monthly = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - (5 - index), 1));
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const group = data.records.filter((record) => record.category === data.user.category && record.recordDate.startsWith(month));
    return { month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: data.user.timezone }).format(date), Attendance: group.filter((record) => ["present", "late"].includes(record.status)).length, Hours: Math.round(group.reduce((sum, record) => sum + recordMinutes(record), 0) / 60 * 10) / 10 };
  });
  const onExport = async (kind: "csv" | "json") => {
    if (kind === "csv") downloadCsv(); else await downloadJson();
  };
  return <>
    <div className="page-heading"><div><h1>Reports</h1><p>Summaries for a useful view of your saved records.</p></div><div className="page-heading-actions"><button className="app-button" onClick={() => window.print()}><FileSpreadsheet size={12} /> Print / PDF</button><button className="app-button app-button-primary" onClick={() => onExport("csv")}><ArrowDownToLine size={12} /> Export CSV</button></div></div>
    <div className="panel" style={{ marginBottom: 12 }}><div className="table-toolbar" style={{ padding: 0, border: 0 }}><div className="filter-row"><label className="form-label" htmlFor="report-range">Report period</label><select id="report-range" className="filter-control" value={range} onChange={(event) => setRange(event.target.value)}><option value="day">Today</option><option value="week">Last 7 days</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom range</option></select>{range === "custom" && <><input aria-label="Report start date" className="filter-control" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /><input aria-label="Report end date" className="filter-control" type="date" value={through} onChange={(event) => setThrough(event.target.value)} /></>}</div><span className="form-hint">{bounds.start} — {bounds.end}</span></div></div>
    <div className="stats-grid">{isStudent ? <><StatCard label="Attendance percentage" value={`${percent(present, studentConducted.length)}%`} foot="Present and late / classes counted" icon="target" /><StatCard label="Classes attended" value={present} foot={`${studentConducted.length} classes counted`} icon="classes" /><StatCard label="Absent" value={rows.filter((record) => record.status === "absent").length} foot="Cancelled and excused excluded" icon="days" /><StatCard label="Subjects" value={new Set(rows.map((record) => record.subjectId).filter(Boolean)).size} foot="With records in this range" icon="classes" /></> : <><StatCard label="Working time" value={formatDuration(totalHours)} foot="Net after unpaid breaks" icon="hours" /><StatCard label="Workdays" value={new Set(rows.filter((record) => record.netMinutes > 0 || record.startAt).map((record) => record.recordDate)).size} foot="Dates with work time" icon="days" /><StatCard label="Average / active day" value={formatDuration(Math.round(totalHours / Math.max(1, new Set(rows.filter((record) => record.netMinutes > 0 || record.startAt).map((record) => record.recordDate)).size)))} foot="Net working time" icon="target" /><StatCard label={data.user.category === "employee" ? "Approved overtime" : "Work sessions"} value={data.user.category === "employee" ? formatDuration(approvedOT) : rows.length} foot={data.user.category === "employee" ? "Pending and rejected excluded" : "Saved sessions in this range"} icon="overtime" /></>}</div>
    <div className="content-grid"><div className="panel"><div className="panel-header"><div><h2>{isStudent ? "Subject breakdown" : "Recent trend"}</h2><p>{isStudent ? "Attendance outcomes by subject" : "Your recorded time over recent months"}</p></div></div>{isStudent ? data.subjects.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Subject</th><th>Present</th><th>Absent</th><th>Cancelled</th><th>Attendance</th><th>Target</th></tr></thead><tbody>{data.subjects.map((subject) => { const group = rows.filter((record) => record.subjectId === subject.id); const valid = group.filter((record) => !["cancelled", "excused"].includes(record.status)); const count = valid.filter((record) => ["present", "late"].includes(record.status)).length; return <tr key={subject.id}><td>{subject.name}<small>{subject.code ?? ""}</small></td><td>{count}</td><td>{group.filter((record) => record.status === "absent").length}</td><td>{group.filter((record) => record.status === "cancelled").length}</td><td><span className={statusClass(`${percent(count, valid.length) >= subject.targetPercent ? "approved" : "pending"}`)}>{percent(count, valid.length)}%</span></td><td>{subject.targetPercent}%</td></tr>; })}</tbody></table></div> : <EmptyState title="Add subjects for a breakdown" description="Subject reports use your real attendance records." /> : <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthly} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="month" axisLine={false} tickLine={false} /><YAxis axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey={data.user.category === "student" ? "Attendance" : "Hours"} fill="#6f956e" radius={[3, 3, 0, 0]} maxBarSize={22} /></BarChart></ResponsiveContainer></div>}</div>
      <div className="panel"><div className="panel-header"><div><h2>Report files</h2><p>Take your data with you.</p></div><span className="stat-icon"><ArrowDownToLine size={14} /></span></div><div className="today-detail"><span>Excel-compatible CSV</span><button className="app-button app-button-sm" onClick={() => onExport("csv")}>Download</button></div><div className="today-detail"><span>Full personal JSON backup</span><button className="app-button app-button-sm" onClick={() => onExport("json")}>Download</button></div><div className="today-detail"><span>PDF-ready report</span><button className="app-button app-button-sm" onClick={() => window.print()}>Print</button></div><p className="form-hint" style={{ marginTop: 10 }}>The CSV reflects the chosen date range. JSON contains your full available personal data. Printing opens your browser’s Save as PDF option.</p></div>
    </div>
    <div className="panel" style={{ marginTop: 12 }}><div className="panel-header"><div><h2>Report details</h2><p>{prettyDate(bounds.start, data.user.timezone, { month: "long", day: "numeric", year: "numeric" })} — {prettyDate(bounds.end, data.user.timezone, { month: "long", day: "numeric", year: "numeric" })}</p></div><span className="status-pill status-present">{rows.length} entries</span></div>{rows.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Status</th><th>Hours / classes</th>{data.user.category === "employee" && <><th>Overtime</th><th>Review</th></>}</tr></thead><tbody>{rows.map((record) => <tr key={record.id}><td>{prettyDate(record.recordDate, data.user.timezone, { month: "short", day: "numeric", year: "numeric" })}</td><td>{data.user.category === "student" ? data.subjects.find((subject) => subject.id === record.subjectId)?.name ?? "—" : data.user.category === "employee" ? data.shifts.find((shift) => shift.id === record.shiftId)?.name ?? "Work" : data.projects.find((project) => project.id === record.projectId)?.name ?? "Personal"}</td><td><span className={statusClass(record.status)}>{categoryStatus(record)}</span></td><td>{data.user.category === "student" ? "1 class" : formatDuration(recordMinutes(record))}</td>{data.user.category === "employee" && <><td>{formatDuration(record.overtimeMinutes)}</td><td><span className={statusClass(record.overtimeStatus)}>{record.overtimeStatus}</span></td></>}</tr>)}</tbody></table></div> : <EmptyState title="No entries in this range" description="Change the date range or record attendance to create a report." />}</div>
  </>;
}
