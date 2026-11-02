import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { authTokens, sessions, shifts, users } from "@/db/schema";
import {
  clearSessionCookie,
  createSession,
  getAuthUser,
  hashPassword,
  hashToken,
  isValidEmail,
  safeUser,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";

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

async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  return response.ok;
}

async function createActionToken(userId: string, purpose: "reset" | "verify") {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (purpose === "reset" ? 60 : 24 * 60) * 60_000);
  await db.insert(authTokens).values({ userId, tokenHash: hashToken(token), purpose, expiresAt });
  return token;
}

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  return user ? json({ user }) : json({ user: null }, 401);
}

export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: "Request origin could not be verified." }, 403);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "A valid JSON request is required." }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (action === "register") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 160) : "";
    const password = typeof body.password === "string" ? body.password : "";
    const category = typeof body.category === "string" ? body.category : "";
    if (!isValidEmail(email)) return json({ error: "Enter a valid email address." }, 400);
    if (fullName.length < 2) return json({ error: "Enter your full name." }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: "Use a password between 8 and 128 characters." }, 400);
    if (!["student", "employee", "self-employed"].includes(category)) return json({ error: "Choose an account category." }, 400);
    try {
      const [user] = await db.insert(users).values({
        email,
        fullName,
        passwordHash: await hashPassword(password),
        category,
        timezone: "Asia/Kolkata",
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
      const verificationToken = await createActionToken(user.id, "verify");
      const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
      await sendEmail(email, "Verify your AV Attendance Tracker email", `<p>Hi ${fullName.replace(/[<>]/g, "")},</p><p>Verify your email to complete your AV Attendance Tracker profile.</p><p><a href="${baseUrl}/verify?token=${encodeURIComponent(verificationToken)}">Verify email address</a></p><p>This link expires in 24 hours.</p>`).catch(() => false);
      const session = await createSession(user.id);
      const response = json({ user: safeUser(user), verificationEmailSent: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM) }, 201);
      response.cookies.set(SESSION_COOKIE, session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: session.expiresAt,
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create account.";
      if (message.includes("users_email_unique") || message.includes("duplicate key")) return json({ error: "An account with this email already exists." }, 409);
      console.error("Registration failed", error);
      return json({ error: "Unable to create your account right now. Please try again." }, 500);
    }
  }

  if (action === "login") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!isValidEmail(email) || !password) return json({ error: "Enter your email and password." }, 400);
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return json({ error: "Email or password is incorrect." }, 401);
    const session = await createSession(user.id);
    const response = json({ user: safeUser(user) });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  }

  if (action === "logout") {
    const user = await getAuthUser(request);
    const cookieHeader = request.headers.get("cookie") ?? "";
    const token = cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (token) {
      try {
        await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(decodeURIComponent(token))));
      } catch {
        // A malformed cookie is still cleared below.
      }
    }
    const response = json({ ok: true, userId: user?.id ?? null });
    response.headers.append("Set-Cookie", clearSessionCookie());
    return response;
  }

  if (action === "forgot-password") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (isValidEmail(email)) {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (user && user.passwordHash) {
        const token = await createActionToken(user.id, "reset");
        const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
        await sendEmail(email, "Reset your AV Attendance Tracker password", `<p>Use this secure link to reset your password.</p><p><a href="${baseUrl}/reset-password?token=${encodeURIComponent(token)}">Reset password</a></p><p>This link expires in one hour. If you did not request a reset, you can ignore this email.</p>`).catch(() => false);
      }
    }
    return json({ message: "If an account exists and email delivery is configured, a reset link will be sent." });
  }

  if (action === "reset-password") {
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 128) return json({ error: "Use a password between 8 and 128 characters." }, 400);
    const [entry] = await db.select().from(authTokens).where(and(
      eq(authTokens.tokenHash, hashToken(token)),
      eq(authTokens.purpose, "reset"),
      isNull(authTokens.usedAt),
      gt(authTokens.expiresAt, new Date()),
    )).limit(1);
    if (!entry) return json({ error: "This reset link is invalid or expired. Request a new one." }, 400);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, entry.userId));
      await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, entry.id));
      await tx.delete(sessions).where(eq(sessions.userId, entry.userId));
    });
    return json({ message: "Your password has been reset. Sign in with your new password." });
  }

  if (action === "verify-email") {
    const token = typeof body.token === "string" ? body.token : "";
    const [entry] = await db.select().from(authTokens).where(and(
      eq(authTokens.tokenHash, hashToken(token)),
      eq(authTokens.purpose, "verify"),
      isNull(authTokens.usedAt),
      gt(authTokens.expiresAt, new Date()),
    )).limit(1);
    if (!entry) return json({ error: "This verification link is invalid or expired." }, 400);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, entry.userId));
      await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, entry.id));
    });
    return json({ message: "Your email address is verified." });
  }

  const user = await getAuthUser(request);
  if (!user) return json({ error: "Sign in to continue." }, 401);

  if (action === "delete-account") {
    if (body.confirmation !== user.email) return json({ error: "Type your account email to confirm deletion." }, 400);
    const [privateUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (privateUser?.passwordHash && !(await verifyPassword(String(body.password ?? ""), privateUser.passwordHash))) {
      return json({ error: "Your password is incorrect." }, 401);
    }
    await db.delete(users).where(eq(users.id, user.id));
    const response = json({ ok: true });
    response.headers.append("Set-Cookie", clearSessionCookie());
    return response;
  }

  if (action === "change-password") {
    const [privateUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!privateUser?.passwordHash || !(await verifyPassword(currentPassword, privateUser.passwordHash))) return json({ error: "Your current password is incorrect." }, 401);
    if (newPassword.length < 8 || newPassword.length > 128) return json({ error: "Use a password between 8 and 128 characters." }, 400);
    await db.update(users).set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, user.id));
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    const session = await createSession(user.id);
    const response = json({ message: "Password updated securely." });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  }

  return json({ error: "Unknown action." }, 400);
}
