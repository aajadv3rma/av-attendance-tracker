import { NextResponse } from "next/server";
import { bearerToken, firebaseAdminAuth, firebaseAdminStore } from "@/lib/firebase-admin";

export const runtime = "nodejs";

function object(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Firebase sign-in is required." }, { status: 401 });
  try {
    const decoded = await firebaseAdminAuth().verifyIdToken(token);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const snapshot = object(body.snapshot);
    const records = Array.isArray(snapshot.records) ? snapshot.records.slice(0, 500) : [];
    const subjects = Array.isArray(snapshot.subjects) ? snapshot.subjects.slice(0, 300) : [];
    const shifts = Array.isArray(snapshot.shifts) ? snapshot.shifts.slice(0, 200) : [];
    const projects = Array.isArray(snapshot.projects) ? snapshot.projects.slice(0, 300) : [];
    const notifications = Array.isArray(snapshot.notifications) ? snapshot.notifications.slice(0, 200) : [];
    await firebaseAdminStore().collection("users").doc(decoded.uid).collection("workspace").doc("current").set({
      user: object(snapshot.user),
      records,
      subjects,
      shifts,
      projects,
      notifications,
      syncedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Firebase workspace sync failed", error);
    return NextResponse.json({ error: "Workspace sync is temporarily unavailable." }, { status: 503 });
  }
}