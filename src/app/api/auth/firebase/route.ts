import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { shifts, users } from "@/db/schema";
import { bearerToken, firebaseAdminAuth } from "@/lib/firebase-admin";
import { createSession, safeUser, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

const categories = ["student", "employee", "self-employed"] as const;

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Firebase sign-in is required." }, { status: 401 });

  try {
    const decoded = await firebaseAdminAuth().verifyIdToken(token);
    const email = decoded.email?.trim().toLowerCase();
    if (!email || decoded.email_verified === false) return NextResponse.json({ error: "Your Firebase email must be verified." }, { status: 403 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const requestedCategory = typeof body.category === "string" ? body.category : "student";
    const category = categories.includes(requestedCategory as typeof categories[number]) ? requestedCategory : "student";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 160) : "";
    let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user) {
      [user] = await db.insert(users).values({
        email,
        fullName: fullName.length >= 2 ? fullName : (decoded.name ?? email.split("@")[0]).slice(0, 160),
        passwordHash: null,
        googleId: decoded.firebase?.sign_in_provider === "google.com" ? decoded.uid : null,
        avatarUrl: decoded.picture ?? null,
        category,
        timezone: "Asia/Kolkata",
        emailVerified: true,
        profile: {},
        preferences: { dateFormat: "MMM d, yyyy", weekStartsOn: 1, theme: "light" },
      }).returning();
      if (category === "employee") {
        await db.insert(shifts).values([
          { userId: user.id, name: "1st Shift", startTime: "07:00", endTime: "15:00", payableMinutes: 480, weekdays: [], breakRules: [], overtimeRules: {} },
          { userId: user.id, name: "General Shift", startTime: "09:00", endTime: "17:00", payableMinutes: 480, weekdays: [], breakRules: [], overtimeRules: {} },
          { userId: user.id, name: "2nd Shift", startTime: "15:00", endTime: "23:00", payableMinutes: 480, weekdays: [], breakRules: [], overtimeRules: {} },
          { userId: user.id, name: "Night Shift", startTime: "23:00", endTime: "07:00", payableMinutes: 480, weekdays: [], breakRules: [], overtimeRules: {} },
        ]);
      }
    }

    const session = await createSession(user.id);
    const response = NextResponse.json({ user: safeUser(user) });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    console.error("Firebase session provisioning failed", error);
    return NextResponse.json({ error: "Firebase sign-in is unavailable right now." }, { status: 503 });
  }
}