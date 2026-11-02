import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { shifts, users } from "@/db/schema";
import { createSession, safeUser, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

function baseUrl(request: Request) {
  return (process.env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

function cookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}

function fail(request: Request, code: string) {
  const response = NextResponse.redirect(new URL(`/workspace?google=${encodeURIComponent(code)}`, baseUrl(request)));
  response.cookies.set("av_google_state", "", { path: "/api/auth/google/callback", maxAge: 0 });
  response.cookies.set("av_google_category", "", { path: "/api/auth/google/callback", maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const stateCookie = decodeURIComponent(cookie(request, "av_google_state"));
  const categoryCookie = decodeURIComponent(cookie(request, "av_google_category"));
  if (error) return fail(request, "cancelled");
  if (!code || !state || !stateCookie || state !== stateCookie) return fail(request, "invalid-state");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(request, "not-configured");

  try {
    const callback = `${baseUrl(request)}/api/auth/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callback, grant_type: "authorization_code" }),
    });
    if (!tokenResponse.ok) return fail(request, "exchange-failed");
    const tokenPayload = await tokenResponse.json() as { access_token?: string };
    if (!tokenPayload.access_token) return fail(request, "exchange-failed");
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      cache: "no-store",
    });
    if (!profileResponse.ok) return fail(request, "profile-failed");
    const profile = await profileResponse.json() as { id?: string; email?: string; verified_email?: boolean; name?: string; picture?: string };
    const email = profile.email?.trim().toLowerCase();
    if (!profile.id || !email || !profile.verified_email) return fail(request, "email-not-verified");
    const matches = await db.select().from(users).where(eq(users.googleId, profile.id)).limit(1);
    let user = matches[0];
    if (!user) {
      const [sameEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (sameEmail?.googleId && sameEmail.googleId !== profile.id) return fail(request, "account-link-conflict");
      if (sameEmail) {
        [user] = await db.update(users).set({ googleId: profile.id, emailVerified: true, avatarUrl: profile.picture ?? sameEmail.avatarUrl, updatedAt: new Date() }).where(and(eq(users.id, sameEmail.id), eq(users.email, email))).returning();
      } else {
        const category = ["student", "employee", "self-employed"].includes(categoryCookie) ? categoryCookie : "student";
        [user] = await db.insert(users).values({
          email,
          fullName: (profile.name ?? email.split("@")[0]).slice(0, 160),
          googleId: profile.id,
          avatarUrl: profile.picture ?? null,
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
    }
    if (!user) return fail(request, "account-unavailable");
    const session = await createSession(user.id);
    const response = NextResponse.redirect(new URL("/workspace", baseUrl(request)));
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: session.expiresAt });
    response.cookies.set("av_google_state", "", { path: "/api/auth/google/callback", maxAge: 0 });
    response.cookies.set("av_google_category", "", { path: "/api/auth/google/callback", maxAge: 0 });
    return response;
  } catch (caught) {
    console.error("Google sign-in failed", caught);
    return fail(request, "unavailable");
  }
}
