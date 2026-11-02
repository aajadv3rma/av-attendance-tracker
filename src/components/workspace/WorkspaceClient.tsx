"use client";

import Link from "next/link";
import {
  Activity, ArrowRight, Bell, BookOpen, CalendarDays, ChartNoAxesColumn, Check, ChevronRight,
  CircleHelp, Clock3, FileText, LayoutDashboard, ListChecks, LogOut, Menu, Moon, PanelLeft,
  Plus, Settings, ShieldCheck, Sparkles, Sun, Timer, UserRound, UsersRound, BriefcaseBusiness,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AuthScreen, { type AccountCategory, type AuthUser } from "./AuthScreen";
import {
  AttendanceView, CalendarView, DashboardView, EntityView, OvertimeView, ReportsView,
} from "./WorkspaceViews";
import SettingsView from "./SettingsView";
import { BulkMarkDialog, EntityDialog, RecordDialog } from "./WorkspaceDialogs";
import { listQueuedAttendance, queueAttendanceAction, removeQueuedAttendance, type QueuedAttendanceAction } from "@/lib/offline-queue";
import { firebaseAuth, syncWorkspaceSnapshot } from "@/lib/firebase";
import type { AttendanceRow, NotificationRow, ProjectRow, ShiftRow, SubjectRow, WorkspaceData } from "./types";

type SyncState = "synced" | "syncing" | "offline" | "failed";
type ToastItem = { id: string; message: string; kind: "success" | "error" };
type DialogState = { kind: "record"; item?: Partial<AttendanceRow> } | { kind: "entity"; entity: "subject" | "shift" | "project"; item?: SubjectRow | ShiftRow | ProjectRow } | { kind: "bulk" } | null;

const iconMap: Record<string, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  attendance: ListChecks,
  calendar: CalendarDays,
  subjects: BookOpen,
  shifts: Clock3,
  projects: BriefcaseBusiness,
  overtime: Timer,
  reports: ChartNoAxesColumn,
  settings: Settings,
};

async function fetchWorkspaceData() {
  const response = await fetch("/api/data", { credentials: "same-origin", cache: "no-store" });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401) return null;
    throw new Error(body.error ?? "Unable to load workspace.");
  }
  return body as WorkspaceData;
}

async function mirrorWorkspace(data: WorkspaceData | null) {
  if (!data) return;
  try { await syncWorkspaceSnapshot(data); } catch { /* The primary workspace must not depend on the mirror. */ }
}

function humanCategory(category: AccountCategory) {
  return category === "self-employed" ? "Self-employed" : category.charAt(0).toUpperCase() + category.slice(1);
}

export default function WorkspaceClient() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("overview");
  const [syncState, setSyncState] = useState<SyncState>("syncing");
  const [pendingCount, setPendingCount] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [theme, setTheme] = useState("light");

  const notify = (message: string, kind: "success" | "error" = "success") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  };

  const refresh = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const nextData = await fetchWorkspaceData();
      setData(nextData);
      setCheckedAuth(true);
      setSyncState(navigator.onLine ? "synced" : "offline");
      if (nextData) setTheme(String(nextData.user.preferences?.theme ?? "light"));
      await mirrorWorkspace(nextData);
      return nextData;
    } catch (error) {
      setSyncState(navigator.onLine ? "failed" : "offline");
      if (showLoading) notify(error instanceof Error ? error.message : "Unable to load your workspace.", "error");
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetchWorkspaceData().then((nextData) => {
      if (!active) return;
      setData(nextData);
      setCheckedAuth(true);
      setTheme(String(nextData?.user.preferences?.theme ?? "light"));
      setSyncState(navigator.onLine ? "synced" : "offline");
      void mirrorWorkspace(nextData);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setCheckedAuth(true);
      setSyncState(navigator.onLine ? "failed" : "offline");
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!data?.user.id) return;
    const refreshPending = async () => {
      try { setPendingCount((await listQueuedAttendance(data.user.id)).length); } catch { setPendingCount(0); }
    };
    const flush = async () => {
      if (!navigator.onLine) { setSyncState("offline"); await refreshPending(); return; }
      setSyncState("syncing");
      try {
        const queue = await listQueuedAttendance(data.user.id);
        setPendingCount(queue.length);
        for (const item of queue) {
          const response = await fetch("/api/data", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.payload) });
          const result = await response.json();
          if (!response.ok) {
            setSyncState("failed");
            notify(`A saved offline action needs attention: ${result.error ?? "sync failed"}`, "error");
            return;
          }
          await removeQueuedAttendance(item.id);
        }
        const remaining = (await listQueuedAttendance(data.user.id)).length;
        setPendingCount(remaining);
        const updatedData = await fetchWorkspaceData();
        setData(updatedData);
        void mirrorWorkspace(updatedData);
        setSyncState("synced");
        if (queue.length) notify(`${queue.length} offline attendance change${queue.length === 1 ? "" : "s"} synced.`);
      } catch (error) {
        setSyncState("failed");
        notify(error instanceof Error ? error.message : "Offline attendance could not sync. It remains safely queued on this device.", "error");
      }
    };
    const online = () => { void flush(); };
    const offline = () => { setSyncState("offline"); void refreshPending(); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    void refreshPending();
    if (navigator.onLine) void flush();
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [data?.user.id]);

  useEffect(() => {
    const preference = theme;
    if (preference === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => document.documentElement.dataset.theme = media.matches ? "dark" : "light";
      apply(); media.addEventListener("change", apply); return () => media.removeEventListener("change", apply);
    }
    document.documentElement.dataset.theme = preference;
  }, [theme]);

  async function callAction(action: string, payload: Record<string, unknown> = {}, queueable = false): Promise<unknown> {
    if (!data) throw new Error("Sign in to continue.");
    const body: Record<string, unknown> = { ...payload, action };
    const canQueue = queueable && ["record.save", "attendance.clock-in", "attendance.clock-out", "attendance.break-start", "attendance.break-end"].includes(action);
    if (canQueue && !navigator.onLine) {
      if (action === "record.save" && !body.clientKey) body.clientKey = crypto.randomUUID();
      if (action.startsWith("attendance.") && !body.requestId) body.requestId = crypto.randomUUID();
      try {
        await queueAttendanceAction(data.user.id, action, body);
        setPendingCount((count) => count + 1);
        setSyncState("offline");
        notify("Saved securely on this device. It will sync when you’re back online.");
        return { queued: true };
      } catch (error) {
        setSyncState("failed");
        throw new Error(error instanceof Error ? `${error.message} Your unsynced entry was not discarded.` : "Offline storage failed; please reconnect before continuing.");
      }
    }
    setSyncState("syncing");
    try {
      const response = await fetch("/api/data", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save your changes.");
      const nextData = await fetchWorkspaceData();
      if (nextData) setData(nextData);
      setSyncState("synced");
      return result;
    } catch (error) {
      const networkError = error instanceof TypeError || !navigator.onLine;
      if (canQueue && networkError) {
        try {
          if (action === "record.save" && !body.clientKey) body.clientKey = crypto.randomUUID();
          if (action.startsWith("attendance.") && !body.requestId) body.requestId = crypto.randomUUID();
          await queueAttendanceAction(data.user.id, action, body);
          setPendingCount((count) => count + 1);
          setSyncState("offline");
          notify("Network dropped. Your attendance change is queued safely on this device.");
          return { queued: true };
        } catch (queueError) {
          setSyncState("failed");
          throw new Error(queueError instanceof Error ? queueError.message : "Could not queue this offline attendance change.");
        }
      }
      setSyncState(navigator.onLine ? "failed" : "offline");
      throw error;
    }
  }

  const onAuthenticated = async (user: AuthUser) => {
    setLoading(true);
    const nextData = await refresh(true);
    if (!nextData) {
      setData(null);
      notify(`Signed in as ${user.fullName}, but your workspace could not load yet.`, "error");
    } else {
      setActiveView("overview");
      notify(`Welcome, ${user.fullName.split(" ")[0]}.`);
    }
  };

  const logout = async () => {
    try { await fetch("/api/auth", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) }); } catch { /* The local workspace still clears on network loss. */ }
    if (firebaseAuth) await firebaseAuth.signOut().catch(() => undefined);
    setData(null); setActiveView("overview"); setNotificationsOpen(false); setDialog(null); setMobileOpen(false); setCheckedAuth(true); notify("You have been signed out.");
  };

  const goTo = (view: string) => {
    if (view.toLowerCase() === "bulk mark") { setDialog({ kind: "bulk" }); setMobileOpen(false); return; }
    setActiveView(view.toLowerCase()); setMobileOpen(false); setNotificationsOpen(false);
  };
  const openRecord = (item?: Partial<AttendanceRow>) => setDialog({ kind: "record", item });
  const openEntity = (kind: "subject" | "shift" | "project", item?: SubjectRow | ShiftRow | ProjectRow) => setDialog({ kind: "entity", entity: kind, item });

  const deleteItem = async (id: string) => {
    if (!data) return;
    const noun = data.user.category === "student" ? "subject" : data.user.category === "employee" ? "shift" : "project";
    if (!window.confirm(`Delete this ${noun}? Existing attendance records remain in your history, but will no longer be linked to it.`)) return;
    const action = `${noun}.delete`;
    try { await callAction(action, { id }); notify(`${noun[0].toUpperCase()}${noun.slice(1)} deleted.`); } catch (error) { notify(error instanceof Error ? error.message : `Unable to delete ${noun}.`, "error"); }
  };

  const saveProfile = async (payload: Record<string, unknown>) => callAction("profile.save", payload);
  const saveEntity = async (action: string, payload: Record<string, unknown>) => callAction(action, payload);

  const category = data?.user.category;
  const navItems = useMemo(() => {
    const common = [
      { id: "overview", label: "Overview", icon: "overview" },
      { id: "attendance", label: "Attendance", icon: "attendance" },
      { id: "calendar", label: "Calendar", icon: "calendar" },
    ];
    const specific = category === "student" ? [{ id: "subjects", label: "Subjects", icon: "subjects" }] : category === "employee" ? [{ id: "shifts", label: "Shifts", icon: "shifts" }, { id: "overtime", label: "Overtime", icon: "overtime" }] : category === "self-employed" ? [{ id: "projects", label: "Projects", icon: "projects" }] : [];
    return [...common, ...specific, { id: "reports", label: "Reports", icon: "reports" }, { id: "settings", label: "Settings", icon: "settings" }];
  }, [category]);

  const unreadCount = data?.notifications.filter((item) => !item.readAt).length ?? 0;
  const activeLabel = navItems.find((item) => item.id === activeView)?.label ?? "Overview";

  if (!checkedAuth || loading) return <main className="workspace-shell"><div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}><div style={{ width: "min(300px,100%)", textAlign: "center" }}><span className="brand-mark" style={{ margin: "0 auto 13px" }}>AV</span><div className="skeleton" style={{ height: 12, width: "65%", margin: "0 auto 9px" }} /><div className="skeleton" style={{ height: 8, width: "42%", margin: "0 auto" }} /><p style={{ color: "#89938b", fontSize: 10, marginTop: 15 }}>Loading your private workspace…</p></div></div></main>;

  if (!data) return <AuthScreen onAuthenticated={onAuthenticated} />;

  const unread = data.notifications.filter((item) => !item.readAt);
  const syncText = syncState === "synced" ? (pendingCount ? `${pendingCount} pending` : "Synced") : syncState === "syncing" ? "Syncing" : syncState === "offline" ? (pendingCount ? `Offline · ${pendingCount} queued` : "Offline") : "Sync failed";

  const recordAction = async (action: string, payload: Record<string, unknown>) => callAction(action, payload, action === "record.save");
  const onNotifyRead = async (notification: NotificationRow) => {
    try { await callAction("notification.read", { id: notification.id }); } catch (error) { notify(error instanceof Error ? error.message : "Could not update notification.", "error"); }
  };

  return <main className={`workspace-shell ${theme === "dark" ? "theme-dark" : ""}`}>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`app-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <Link href="/" className="app-brand"><span className="brand-mark">AV</span><span><span className="app-brand-text">AV Attendance Tracker</span><span className="app-brand-sub">Your personal workspace</span></span></Link>
      <div className="workspace-nav-label">Workspace</div><nav className="workspace-nav" aria-label="Workspace navigation">{navItems.slice(0, 3).map((item) => { const Icon = iconMap[item.icon]; return <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => goTo(item.id)}><Icon size={14} />{item.label}</button>; })}</nav>
      {navItems.length > 3 && <><div className="workspace-nav-label">Manage</div><nav className="workspace-nav" aria-label="Management navigation">{navItems.slice(3, -2).map((item) => { const Icon = iconMap[item.icon]; return <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => goTo(item.id)}><Icon size={14} />{item.label}{item.id === "overtime" && unread.some((entry) => entry.kind === "overtime-status") && <span className="nav-badge">!</span>}</button>; })}</nav></>}
      <div className="workspace-nav-label">Insights</div><nav className="workspace-nav" aria-label="Insights navigation">{navItems.filter((item) => item.id === "reports").map((item) => { const Icon = iconMap[item.icon]; return <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => goTo(item.id)}><Icon size={14} />{item.label}</button>; })}</nav>
      <div className="sidebar-spacer" />
      <Link href="/about" className="sidebar-help"><span className="stat-icon"><CircleHelp size={14} /></span><span><strong>About AV</strong><span>How your workspace works</span></span><ChevronRight size={12} style={{ marginLeft: "auto" }} /></Link>
      <button className={`workspace-nav-button ${activeView === "settings" ? "active" : ""}`} style={{ display: "flex", width: "100%", alignItems: "center", gap: 11, minHeight: 36, padding: "0 10px", border: 0, borderRadius: 6, color: "var(--app-muted)", background: "transparent", fontSize: 10, fontWeight: 600 }} onClick={() => goTo("settings")}><Settings size={14} />Settings</button>
      <div className="sidebar-bottom"><button className="account-chip" style={{ border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }} onClick={() => goTo("settings")}><span className="account-avatar">{data.user.avatarUrl ? <img src={data.user.avatarUrl} alt="" /> : data.user.fullName.slice(0, 1).toUpperCase()}</span><span><strong>{data.user.fullName}</strong><span>{humanCategory(data.user.category)}</span></span></button><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => void logout()}><LogOut size={13} /></button></div>
    </aside>

    <div className="workspace-main">
      <header className="workspace-topbar"><button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={17} /></button><div className="topbar-breadcrumb"><span>AV Workspace</span><ChevronRight size={12} /><strong>{activeLabel}</strong></div><div className="topbar-actions"><span className={`sync-state ${syncState}`} title={pendingCount ? `${pendingCount} attendance changes are waiting to sync` : syncText}><i />{syncText}</span><button className="topbar-action" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title="Toggle theme" onClick={() => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); void callAction("settings.save", { preferences: { theme: next } }).catch((error) => notify(error instanceof Error ? error.message : "Theme preference could not sync.", "error")); }}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button><button className="topbar-action" aria-label="Notifications" title="Notifications" onClick={() => setNotificationsOpen((open) => !open)}><Bell size={15} />{unreadCount > 0 && <i className="notification-dot" />}</button></div>
      </header>

      {notificationsOpen && <div className="notification-popover" style={{ position: "absolute", zIndex: 30, top: 62, right: 23, width: "min(340px,calc(100vw - 30px))", maxHeight: 420, overflow: "auto", padding: 13, border: "1px solid var(--app-line)", borderRadius: 8, background: "var(--app-card)", boxShadow: "0 16px 45px rgba(20,37,24,.14)" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}><strong style={{ color: "var(--app-ink)", fontFamily: "Georgia,serif", fontSize: 15, fontWeight: 400 }}>Notifications</strong>{unread.length > 0 && <button className="panel-link" onClick={() => void callAction("notifications.read-all").catch((error) => notify(error.message, "error"))}>Mark all read</button>}</div>{data.notifications.length ? data.notifications.map((notification) => <button key={notification.id} onClick={() => void onNotifyRead(notification)} style={{ display: "flex", width: "100%", gap: 9, padding: "10px 4px", border: 0, borderTop: "1px solid var(--app-line)", color: "var(--app-ink)", background: "transparent", textAlign: "left" }}><span className="recent-icon"><Bell size={12} /></span><span style={{ flex: 1 }}><strong style={{ display: "block", fontSize: 9 }}>{notification.title}{!notification.readAt && <i className="notification-dot" style={{ position: "static", display: "inline-block", marginLeft: 5 }} />}</strong><span style={{ display: "block", marginTop: 4, color: "var(--app-muted)", fontSize: 8, lineHeight: 1.5 }}>{notification.message}</span><small style={{ display: "block", marginTop: 4, color: "var(--app-muted)", fontSize: 7 }}>{new Date(notification.createdAt).toLocaleString()}</small></span></button>) : <div className="empty-state"><strong>You’re all caught up</strong><p>New attendance and overtime updates will appear here.</p></div>}</div>}

      <section className="workspace-content">
        {activeView === "overview" && <DashboardView data={data} onNavigate={goTo} onRecord={openRecord} onAction={callAction} onDelete={deleteItem} onEditEntity={openEntity} />}
        {activeView === "attendance" && <AttendanceView data={data} onNavigate={goTo} onRecord={openRecord} onAction={callAction} onDelete={deleteItem} onEditEntity={openEntity} />}
        {activeView === "calendar" && <CalendarView data={data} onNavigate={goTo} onRecord={openRecord} onAction={callAction} onDelete={deleteItem} onEditEntity={openEntity} />}
        {["subjects", "shifts", "projects"].includes(activeView) && <EntityView data={data} onNavigate={goTo} onRecord={openRecord} onAction={callAction} onDelete={deleteItem} onEditEntity={openEntity} />}
        {activeView === "overtime" && <OvertimeView data={data} onNavigate={goTo} onRecord={openRecord} onAction={callAction} onDelete={deleteItem} onEditEntity={openEntity} />}
        {activeView === "reports" && <ReportsView data={data} onNavigate={goTo} onRecord={openRecord} onAction={callAction} onDelete={deleteItem} onEditEntity={openEntity} />}
        {activeView === "settings" && <SettingsView data={data} onSave={saveProfile} onAction={callAction} onLogout={logout} onTheme={(next) => setTheme(next)} notify={notify} />}
        {data.truncated && <p className="form-hint" style={{ marginTop: 12 }}>Showing the latest 500 attendance records in this workspace. Export your data to retrieve your full history.</p>}
      </section>
    </div>

    <nav className="mobile-bottom-nav" aria-label="Quick navigation">{navItems.filter((item) => ["overview", "attendance", "calendar", "overtime", "settings"].includes(item.id)).slice(0, 4).map((item) => { const Icon = iconMap[item.icon]; return <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => goTo(item.id)}><Icon size={15} />{item.label}</button>; })}</nav>
    {dialog?.kind === "record" && <RecordDialog data={data} record={dialog.item} onClose={() => setDialog(null)} onSubmit={recordAction} onNotify={notify} />}
    {dialog?.kind === "entity" && <EntityDialog data={data} kind={dialog.entity} item={dialog.item} onClose={() => setDialog(null)} onSubmit={saveEntity} onNotify={notify} />}
    {dialog?.kind === "bulk" && <BulkMarkDialog data={data} onClose={() => setDialog(null)} onSubmit={saveEntity} onNotify={notify} />}
    <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className={`toast ${toast.kind === "error" ? "error" : ""}`} key={toast.id}><span>{toast.kind === "error" ? <ShieldCheck size={14} /> : <Check size={14} />}</span>{toast.message}</div>)}</div>
  </main>;
}
