"use client";

import { Download, KeyRound, LockKeyhole, Palette, Settings2, ShieldCheck, Trash2, UserRound, Bell, Clock3, GraduationCap } from "lucide-react";
import { FormEvent, useEffect, useState, type ChangeEvent } from "react";
import type { WorkspaceData } from "./types";
import { asObject } from "./types";
import { dateInTimezone } from "@/lib/time";
import { clearQueuedAttendance } from "@/lib/offline-queue";

type Props = {
  data: WorkspaceData;
  onSave: (payload: Record<string, unknown>) => Promise<unknown>;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  onLogout: () => void;
  onTheme: (theme: string) => void;
  notify: (message: string, kind?: "success" | "error") => void;
};

const tabs = [
  { id: "profile", name: "Profile", icon: UserRound },
  { id: "preferences", name: "Preferences", icon: Settings2 },
  { id: "attendance", name: "Attendance rules", icon: Clock3 },
  { id: "notifications", name: "Notifications", icon: Bell },
  { id: "security", name: "Security & data", icon: ShieldCheck },
];

export default function SettingsView({ data, onSave, onAction, onLogout, onTheme, notify }: Props) {
  const profileData = asObject(data.user.profile);
  const initialPreferences = data.user.preferences ?? {};
  const initialEmployee = asObject(initialPreferences.employee);
  const initialOvertime = asObject(initialEmployee.overtime);
  const [tab, setTab] = useState("profile");
  const [fullName, setFullName] = useState(data.user.fullName);
  const [timezone, setTimezone] = useState(data.user.timezone || "Asia/Kolkata");
  const [avatarUrl, setAvatarUrl] = useState(data.user.avatarUrl ?? "");
  const [profile, setProfile] = useState<Record<string, unknown>>(profileData);
  const [preferences, setPreferences] = useState<Record<string, unknown>>(initialPreferences);
  const [employee, setEmployee] = useState<Record<string, unknown>>(initialEmployee);
  const [overtime, setOvertime] = useState<Record<string, unknown>>(initialOvertime);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [pendingNotifications, setPendingNotifications] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [pendingTheme, setPendingTheme] = useState(String(initialPreferences.theme ?? "light"));
  const [daysOff, setDaysOff] = useState<number[]>(Array.isArray(profileData.weeklyDaysOff) ? profileData.weeklyDaysOff as number[] : [0, 6]);

  useEffect(() => {
    setFullName(data.user.fullName);
    setTimezone(data.user.timezone || "Asia/Kolkata");
    setAvatarUrl(data.user.avatarUrl ?? "");
    setProfile(asObject(data.user.profile));
    setPreferences(asObject(data.user.preferences));
    const nextEmployee = asObject(asObject(data.user.preferences).employee);
    setEmployee(nextEmployee);
    setOvertime(asObject(nextEmployee.overtime));
    setPendingTheme(String(asObject(data.user.preferences).theme ?? "light"));
    setDaysOff(Array.isArray(asObject(data.user.profile).weeklyDaysOff) ? asObject(data.user.profile).weeklyDaysOff as number[] : [0, 6]);
  }, [data.user.id, data.user.updatedAt]);

  const putProfile = (key: string, value: unknown) => setProfile((current) => ({ ...current, [key]: value }));
  const putEmployee = (key: string, value: unknown) => setEmployee((current) => ({ ...current, [key]: value }));
  const putOvertime = (key: string, value: unknown) => setOvertime((current) => ({ ...current, [key]: value }));
  const putPreference = (key: string, value: unknown) => setPreferences((current) => ({ ...current, [key]: value }));
  const submitSave = async (event?: FormEvent) => {
    event?.preventDefault();
    setSaving(true);
    try {
      const nextProfile = { ...profile, avatarUrl: avatarUrl || null, weeklyDaysOff: daysOff };
      const nextPreferences = { ...preferences, employee: { ...employee, overtime }, theme: pendingTheme };
      await onSave({ fullName, timezone, profile: nextProfile, preferences: nextPreferences });
      onTheme(pendingTheme);
      notify("Your settings were saved.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Could not save settings.", "error");
    } finally {
      setSaving(false);
    }
  };
  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) return notify("Use a password of at least 8 characters.", "error");
    try {
      const response = await fetch("/api/auth", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "change-password", currentPassword, newPassword }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update password.");
      setCurrentPassword(""); setNewPassword(""); notify("Password updated.");
    } catch (caught) { notify(caught instanceof Error ? caught.message : "Could not update password.", "error"); }
  };
  const deleteAccount = async () => {
    try {
      await fetch("/api/auth", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete-account", confirmation: confirmDelete, password: deletePassword }) }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not delete account."); return body; });
      await clearQueuedAttendance(data.user.id).catch(() => undefined);
      onLogout();
    } catch (caught) { notify(caught instanceof Error ? caught.message : "Could not delete account.", "error"); }
  };
  const exportData = async () => {
    const response = await fetch("/api/data", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "data.export" }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Unable to export data.");
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `av-attendance-backup-${dateInTimezone(new Date(), timezone)}.json`; link.click(); URL.revokeObjectURL(url);
    notify("Your personal data backup is ready.");
  };

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return notify("Backup files must be 10 MB or smaller.", "error");
    setRestoring(true);
    try {
      const backup = JSON.parse(await file.text()) as { user?: { category?: string } };
      if (!backup.user?.category) throw new Error("This file does not look like an AV Attendance Tracker backup.");
      if (backup.user.category !== data.user.category) throw new Error("This backup belongs to a different account category.");
      if (!window.confirm("Restore this backup into your current account? Existing records are preserved and duplicate records will be skipped.")) return;
      const result = await onAction("data.import", { backup }) as { restored?: Record<string, number> };
      const restored = result.restored ?? {};
      const count = Object.values(restored).reduce((total, value) => total + value, 0);
      notify(`${count} backup item${count === 1 ? "" : "s"} restored.`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Could not restore this backup.", "error");
    } finally { setRestoring(false); }
  };

  const activeTab = tabs.find((item) => item.id === tab)?.name ?? "Profile";
  return <>
    <div className="page-heading"><div><h1>Settings</h1><p>Personalize your profile, time rules, notifications, and privacy.</p></div><button className="app-button app-button-primary" onClick={() => submitSave()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
    <div className="settings-layout"><nav className="settings-tabs" aria-label="Settings sections">{tabs.map((item) => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon size={13} />{item.name}</button>; })}</nav>
      <section className="settings-panel"><h2>{activeTab}</h2><p>Changes are stored with your private account and synchronize on your next save.</p>
        {tab === "profile" && <>
          <div className="settings-section"><h3>Personal information</h3><div className="form-grid"><div className="form-field"><label htmlFor="settings-name">Full name</label><input id="settings-name" value={fullName} maxLength={160} onChange={(event) => setFullName(event.target.value)} /></div><div className="form-field"><label htmlFor="settings-email">Email address</label><input id="settings-email" value={data.user.email} disabled /><span className="form-hint">Email address changes are managed through your sign-in provider.</span></div><div className="form-field"><label htmlFor="settings-avatar">Profile photo URL (optional)</label><input id="settings-avatar" type="url" value={avatarUrl} placeholder="https://…" onChange={(event) => setAvatarUrl(event.target.value)} /><span className="form-hint">Use an image URL you control. It is displayed only in your workspace.</span></div><div className="form-field"><label htmlFor="settings-timezone">Timezone</label><select id="settings-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="Asia/Kolkata">Asia/Kolkata (IST)</option><option value="Asia/Dubai">Asia/Dubai (GST)</option><option value="Asia/Singapore">Asia/Singapore (SGT)</option><option value="Europe/London">Europe/London</option><option value="Europe/Paris">Europe/Paris</option><option value="America/New_York">America/New_York</option><option value="America/Los_Angeles">America/Los_Angeles</option><option value="Australia/Sydney">Australia/Sydney</option><option value="UTC">UTC</option>{!['Asia/Kolkata','Asia/Dubai','Asia/Singapore','Europe/London','Europe/Paris','America/New_York','America/Los_Angeles','Australia/Sydney','UTC'].includes(timezone) && <option value={timezone}>{timezone}</option>}</select></div></div></div>
          {data.user.category === "student" && <div className="settings-section"><h3>Academic profile</h3><div className="form-grid"><div className="form-field"><label htmlFor="institution">School or college</label><input id="institution" value={String(profile.institution ?? "")} onChange={(event) => putProfile("institution", event.target.value)} placeholder="Institution name" /></div><div className="form-field"><label htmlFor="course">Course / degree</label><input id="course" value={String(profile.course ?? "")} onChange={(event) => putProfile("course", event.target.value)} placeholder="e.g. B.Sc. Computer Science" /></div><div className="form-field"><label htmlFor="academic-year">Class / semester / academic year</label><input id="academic-year" value={String(profile.academicYear ?? "")} onChange={(event) => putProfile("academicYear", event.target.value)} placeholder="e.g. Semester 4 · 2026" /></div><div className="form-field"><label htmlFor="roll-number">Roll number (optional)</label><input id="roll-number" value={String(profile.rollNumber ?? "")} onChange={(event) => putProfile("rollNumber", event.target.value)} /></div><div className="form-field"><label htmlFor="academic-session">Academic session</label><input id="academic-session" value={String(profile.academicSession ?? "")} onChange={(event) => putProfile("academicSession", event.target.value)} placeholder="e.g. 2025–26" /></div><div className="form-field"><label htmlFor="student-target">Default attendance target (%)</label><input id="student-target" type="number" min="0" max="100" value={Number(profile.minimumAttendance ?? 75)} onChange={(event) => putProfile("minimumAttendance", Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /></div></div></div>}
          {data.user.category === "employee" && <div className="settings-section"><h3>Employee profile</h3><div className="form-grid"><div className="form-field"><label htmlFor="company">Company / organization</label><input id="company" value={String(profile.organization ?? "")} onChange={(event) => putProfile("organization", event.target.value)} placeholder="Optional" /></div><div className="form-field"><label htmlFor="employee-id">Employee ID (optional)</label><input id="employee-id" value={String(profile.employeeId ?? "")} onChange={(event) => putProfile("employeeId", event.target.value)} /></div></div></div>}
          {data.user.category === "self-employed" && <div className="settings-section"><h3>Flexible work profile</h3><div className="form-grid"><div className="form-field"><label htmlFor="profession">Role / profession</label><input id="profession" value={String(profile.profession ?? "")} onChange={(event) => putProfile("profession", event.target.value)} placeholder="e.g. Independent designer" /></div><div className="form-field"><label htmlFor="business">Business (optional)</label><input id="business" value={String(profile.businessName ?? "")} onChange={(event) => putProfile("businessName", event.target.value)} /></div></div></div>}
        </>}

        {tab === "preferences" && <>
          <div className="settings-section"><h3>Appearance</h3><div className="form-grid"><div className="form-field"><label htmlFor="theme">Color theme</label><select id="theme" value={pendingTheme} onChange={(event) => setPendingTheme(event.target.value)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></div><div className="form-field"><label htmlFor="date-format">Date display</label><select id="date-format" value={String(preferences.dateFormat ?? "MMM d, yyyy")} onChange={(event) => putPreference("dateFormat", event.target.value)}><option value="MMM d, yyyy">May 12, 2026</option><option value="dd/MM/yyyy">12/05/2026</option><option value="yyyy-MM-dd">2026-05-12</option></select></div><div className="form-field"><label htmlFor="time-format">Time format</label><select id="time-format" value={String(preferences.timeFormat ?? "12h")} onChange={(event) => putPreference("timeFormat", event.target.value)}><option value="12h">12-hour clock</option><option value="24h">24-hour clock</option></select></div><div className="form-field"><label htmlFor="week-start">Week starts on</label><select id="week-start" value={String(preferences.weekStartsOn ?? 1)} onChange={(event) => putPreference("weekStartsOn", Number(event.target.value))}><option value="0">Sunday</option><option value="1">Monday</option><option value="6">Saturday</option></select></div></div></div>
          {data.user.category !== "student" && <div className="settings-section"><h3>Personal working targets</h3><div className="form-grid"><div className="form-field"><label htmlFor="daily-target">Daily target (hours)</label><input id="daily-target" type="number" min="0" max="24" step="0.25" value={Number(employee.dailyTargetHours ?? 8)} onChange={(event) => putEmployee("dailyTargetHours", Number(event.target.value) || 0)} /></div><div className="form-field"><label htmlFor="weekly-target">Weekly target (hours)</label><input id="weekly-target" type="number" min="0" max="168" step="0.5" value={Number(employee.weeklyTargetHours ?? 40)} onChange={(event) => putEmployee("weeklyTargetHours", Number(event.target.value) || 0)} /></div>{data.user.category === "self-employed" && <div className="form-field"><label htmlFor="monthly-target">Monthly target (hours)</label><input id="monthly-target" type="number" min="0" max="744" step="1" value={Number(employee.monthlyTargetHours ?? 160)} onChange={(event) => putEmployee("monthlyTargetHours", Number(event.target.value) || 0)} /></div>}</div></div>}
          {data.user.category === "self-employed" && <div className="settings-section"><h3>Flexible schedule</h3><span className="form-label">Weekly rest days</span><div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => <label className="form-check-row" key={label}><input type="checkbox" checked={daysOff.includes(index)} onChange={(event) => setDaysOff((current) => event.target.checked ? [...current, index].sort() : current.filter((day) => day !== index))} />{label}</label>)}</div></div>}
          <div className="settings-section"><h3>Notification preferences</h3><label className="form-check-row"><input type="checkbox" checked={Boolean(preferences.browserNotifications)} onChange={(event) => putPreference("browserNotifications", event.target.checked)} /> Enable browser notifications (permission is requested only after you opt in)</label><p className="form-hint" style={{ marginTop: 7 }}>For reliable reminders, allow notifications in your browser after saving. This app does not request permission automatically.</p></div>
        </>}

        {tab === "attendance" && <>
          {data.user.category === "student" ? <><div className="settings-section"><h3>Attendance calculation</h3><p className="form-hint">Present and late classes count as attended. Absent classes count as missed. Cancelled and excused classes are excluded from the attendance denominator so they do not count as attended or missed.</p><div className="form-field" style={{ maxWidth: 260, marginTop: 10 }}><label htmlFor="default-target">Default minimum attendance (%)</label><input id="default-target" type="number" min="0" max="100" value={Number(profile.minimumAttendance ?? 75)} onChange={(event) => putProfile("minimumAttendance", Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /><span className="form-hint">Each subject can set its own target from the Subjects page.</span></div></div><div className="settings-section"><h3>Weekly class days</h3><div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => <label className="form-check-row" key={label}><input type="checkbox" checked={(Array.isArray(profile.workingDays) ? profile.workingDays as number[] : [1, 2, 3, 4, 5]).includes(index)} onChange={(event) => { const current = Array.isArray(profile.workingDays) ? profile.workingDays as number[] : [1, 2, 3, 4, 5]; putProfile("workingDays", event.target.checked ? [...current, index].sort() : current.filter((day) => day !== index)); }} />{label}</label>)}</div></div></> : <>
            <div className="settings-section"><h3>Attendance rules</h3><div className="form-grid"><div className="form-field"><label htmlFor="grace">Grace period (minutes)</label><input id="grace" type="number" min="0" max="180" value={Number(employee.gracePeriodMinutes ?? 0)} onChange={(event) => putEmployee("gracePeriodMinutes", Math.max(0, Number(event.target.value) || 0))} /></div><div className="form-field"><label htmlFor="half-day">Minimum hours for half day</label><input id="half-day" type="number" min="0" max="24" step="0.25" value={Number(employee.halfDayMinimumHours ?? 4)} onChange={(event) => putEmployee("halfDayMinimumHours", Math.max(0, Number(event.target.value) || 0))} /></div><div className="form-field"><label htmlFor="working-days">Expected working days / week</label><input id="working-days" type="number" min="1" max="7" value={Number(employee.workingDaysPerWeek ?? 5)} onChange={(event) => putEmployee("workingDaysPerWeek", Math.max(1, Math.min(7, Number(event.target.value) || 5)))} /></div><div className="form-field"><label htmlFor="paid-break">Paid break allowance (minutes)</label><input id="paid-break" type="number" min="0" max="600" value={Number(employee.paidBreakMinutes ?? 0)} onChange={(event) => putEmployee("paidBreakMinutes", Math.max(0, Number(event.target.value) || 0))} /><span className="form-hint">Paid breaks are not deducted from net time; unpaid breaks are.</span></div><div className="form-field full"><label htmlFor="holidays">Personal / public holidays (one YYYY-MM-DD per line)</label><textarea id="holidays" value={Array.isArray(employee.holidays) ? (employee.holidays as string[]).join("\n") : ""} onChange={(event) => putEmployee("holidays", event.target.value.split(/\s+/).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).slice(0, 150))} placeholder="2026-01-26&#10;2026-08-15" /><span className="form-hint">Holiday work may be overtime when the holiday rule is enabled.</span></div></div></div>
            {data.user.category === "employee" && <div className="settings-section"><h3>Overtime rules</h3><div className="form-grid"><div className="form-field"><label htmlFor="ot-mode">Calculation method</label><select id="ot-mode" value={String(overtime.method ?? "scheduled-shift")} onChange={(event) => putOvertime("method", event.target.value)}><option value="scheduled-shift">Scheduled shift</option><option value="daily-threshold">Daily threshold</option><option value="weekly-threshold">Weekly threshold</option></select><span className="form-hint">Weekly threshold is exclusive of daily overtime to prevent double counting.</span></div><div className="form-field"><label htmlFor="daily-threshold">Daily overtime threshold (minutes)</label><input id="daily-threshold" type="number" min="0" max="1440" value={Number(overtime.dailyThresholdMinutes ?? 480)} onChange={(event) => putOvertime("dailyThresholdMinutes", Math.max(0, Number(event.target.value) || 0))} /></div><div className="form-field"><label htmlFor="weekly-threshold">Weekly overtime threshold (minutes)</label><input id="weekly-threshold" type="number" min="0" max="10080" value={Number(overtime.weeklyThresholdMinutes ?? 2400)} onChange={(event) => putOvertime("weeklyThresholdMinutes", Math.max(0, Number(event.target.value) || 0))} /></div><div className="form-field"><label htmlFor="min-ot">Minimum extra minutes</label><input id="min-ot" type="number" min="0" max="1440" value={Number(overtime.minOvertimeMinutes ?? 0)} onChange={(event) => putOvertime("minOvertimeMinutes", Math.max(0, Number(event.target.value) || 0))} /></div><div className="form-field"><label htmlFor="rounding">Rounding interval</label><select id="rounding" value={Number(overtime.roundingMinutes ?? 1)} onChange={(event) => putOvertime("roundingMinutes", Number(event.target.value))}><option value="1">Exact minutes</option><option value="5">Nearest 5 minutes</option><option value="10">Nearest 10 minutes</option><option value="15">Nearest 15 minutes</option><option value="30">Nearest 30 minutes</option></select></div><div className="form-field"><label htmlFor="max-ot">Maximum daily overtime (minutes, optional)</label><input id="max-ot" type="number" min="0" max="1440" value={Number(overtime.maxDailyMinutes ?? 0)} onChange={(event) => putOvertime("maxDailyMinutes", Number(event.target.value) > 0 ? Number(event.target.value) : null)} placeholder="No cap" /></div></div><div style={{ display: "grid", gap: 9, marginTop: 12 }}><label className="form-check-row"><input type="checkbox" checked={Boolean(overtime.earlyArrivalEligible)} onChange={(event) => putOvertime("earlyArrivalEligible", event.target.checked)} /> Count eligible work before scheduled shift start</label><label className="form-check-row"><input type="checkbox" checked={overtime.afterShiftEligible !== false} onChange={(event) => putOvertime("afterShiftEligible", event.target.checked)} /> Count eligible work after scheduled shift end</label><label className="form-check-row"><input type="checkbox" checked={overtime.holidayOvertime !== false} onChange={(event) => putOvertime("holidayOvertime", event.target.checked)} /> Treat weekly-off / holiday work as eligible overtime</label><label className="form-check-row"><input type="checkbox" checked={Boolean(overtime.approvalRequired)} onChange={(event) => putOvertime("approvalRequired", event.target.checked)} /> Require an overtime review status (personal accounts can manage this manually)</label></div><div className="form-hint" style={{ marginTop: 12, padding: 10, borderRadius: 5, background: "var(--app-soft)" }}>Eligible work minutes = actual session time less unpaid breaks. Scheduled payable hours are configured per shift; overtime is calculated only above that baseline. Early time is excluded unless selected. Rounding is applied after the minimum threshold.</div></div>}
            {data.user.category === "employee" && <div className="settings-section"><h3>Compensatory time</h3><label className="form-check-row"><input type="checkbox" checked={Boolean(employee.compOffEnabled)} onChange={(event) => putEmployee("compOffEnabled", event.target.checked)} /> Enable personal comp-off tracking</label><div className="form-field" style={{ maxWidth: 250, marginTop: 9 }}><label htmlFor="comp-off-rate">Minutes of overtime per comp-off hour</label><input id="comp-off-rate" type="number" min="1" max="1440" value={Number(employee.compOffMinutesPerHour ?? 60)} onChange={(event) => putEmployee("compOffMinutesPerHour", Math.max(1, Number(event.target.value) || 60))} /></div><span className="form-hint">Comp-off balances are a personal tracking estimate. They do not also count as paid overtime.</span></div>}
          </>}
        </>}

        {tab === "notifications" && <><div className="settings-section"><h3>In-app notifications</h3><p className="form-hint">In-app messages appear in your workspace notification menu. You can mark them as read from the top bar.</p><label className="form-check-row" style={{ marginTop: 12 }}><input type="checkbox" checked={Boolean(preferences.attendanceReminders)} onChange={(event) => putPreference("attendanceReminders", event.target.checked)} /> Attendance reminders</label><label className="form-check-row" style={{ marginTop: 10 }}><input type="checkbox" checked={Boolean(preferences.overtimeNotifications)} onChange={(event) => putPreference("overtimeNotifications", event.target.checked)} /> Overtime and review updates</label><label className="form-check-row" style={{ marginTop: 10 }}><input type="checkbox" checked={Boolean(preferences.weeklySummary)} onChange={(event) => putPreference("weeklySummary", event.target.checked)} /> Weekly summary preference</label><label className="form-check-row" style={{ marginTop: 10 }}><input type="checkbox" checked={Boolean(preferences.monthlySummary)} onChange={(event) => putPreference("monthlySummary", event.target.checked)} /> Monthly summary preference</label></div><div className="settings-section"><h3>Browser notifications</h3><p className="form-hint">Browser reminders require explicit browser permission. This app will not prompt until you choose Enable below.</p><div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10 }}><button className="app-button" onClick={async () => { if (!("Notification" in window)) return notify("This browser does not support web notifications.", "error"); const permission = await Notification.requestPermission(); setPendingNotifications(permission === "granted" ? 1 : 0); putPreference("browserNotifications", permission === "granted"); notify(permission === "granted" ? "Browser notifications are enabled." : "Notification permission was not granted.", permission === "granted" ? "success" : "error"); }}>{pendingNotifications || preferences.browserNotifications ? "Notifications enabled" : "Enable browser notifications"}</button><span className="form-hint">{typeof Notification !== "undefined" ? `Current permission: ${Notification.permission}` : "Not supported"}</span></div></div></>}

        {tab === "security" && <>
          <div className="settings-section"><h3>Sign-in security</h3><p className="form-hint">Signed-in sessions are protected with an HTTP-only cookie and revocable server-side session token. Passwords are stored as salted hashes, never plain text.</p><div className="form-grid" style={{ marginTop: 12 }}><div className="form-field"><label htmlFor="verified">Email status</label><input id="verified" readOnly value={data.user.emailVerified ? "Verified" : "Not verified"} /></div><div className="form-field"><label htmlFor="registered">Account created</label><input id="registered" readOnly value={data.user.createdAt ? new Date(data.user.createdAt).toLocaleDateString() : "—"} /></div></div></div>
          <div className="settings-section"><h3>Change password</h3><form onSubmit={savePassword}><div className="form-grid"><div className="form-field"><label htmlFor="current-password">Current password</label><input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div><div className="form-field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div></div><div className="form-actions"><button type="submit" className="app-button"><KeyRound size={12} /> Update password</button></div></form></div>
          <div className="settings-section"><h3>Your personal data</h3><p className="form-hint">Download a JSON backup of your profile, subjects, shifts, projects, attendance records, and overtime calculation history. Restore merges attendance structures and records into this account; it does not replace your identity or current preferences.</p><div className="form-actions" style={{ justifyContent: "flex-start", borderTop: 0, paddingTop: 8 }}><button className="app-button" onClick={() => void exportData().catch((error) => notify(error instanceof Error ? error.message : "Export failed.", "error"))}><Download size={12} /> Export all my data</button><label className="app-button" style={{ cursor: restoring ? "wait" : "pointer" }}><input type="file" accept="application/json,.json" disabled={restoring} onChange={(event) => void restoreBackup(event)} style={{ display: "none" }} />{restoring ? "Restoring…" : "Restore backup"}</label><button className="app-button" onClick={onLogout}>Sign out securely</button></div></div>
          <div className="settings-danger"><h3>Permanently delete account</h3><p>This permanently deletes your profile, attendance, subjects, shifts, projects, notifications, and related records. This cannot be undone. Type your account email to confirm.</p><div className="form-grid"><div className="form-field"><label htmlFor="delete-confirm">Account email</label><input id="delete-confirm" type="email" value={confirmDelete} onChange={(event) => setConfirmDelete(event.target.value)} placeholder={data.user.email} /></div>{data.user.emailVerified !== undefined && <div className="form-field"><label htmlFor="delete-password">Password (if using email sign-in)</label><input id="delete-password" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="Required for password accounts" /></div>}</div><div className="form-actions"><button className="app-button app-button-danger" disabled={confirmDelete !== data.user.email} onClick={() => void deleteAccount()}><Trash2 size={12} /> Delete my account</button></div></div>
        </>}
        {tab !== "security" && <div className="form-actions"><button className="app-button app-button-primary" onClick={() => submitSave()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>}
      </section>
    </div>
  </>;
}
