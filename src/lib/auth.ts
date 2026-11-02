import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "av_session";
const SESSION_DAYS = 30;

export type PublicUser = Omit<typeof users.$inferSelect, "passwordHash">;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [algorithm, salt, savedHex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !savedHex) return false;
  const saved = Buffer.from(savedHex, "hex");
  const candidate = (await scrypt(password, salt, saved.length)) as Buffer;
  return saved.length === candidate.length && timingSafeEqual(saved, candidate);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  const value = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!value) return null;
  try {
    return decodeURIComponent(value.slice(name.length + 1));
  } catch {
    return null;
  }
}

export async function getAuthUser(request: Request): Promise<PublicUser | null> {
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const [result] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!result) return null;
  const { passwordHash: _passwordHash, ...publicUser } = result.user;
  return publicUser;
}

export function sessionCookie(token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

export function safeUser(user: typeof users.$inferSelect): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}
