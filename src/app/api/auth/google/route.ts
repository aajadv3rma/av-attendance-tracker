import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function baseUrl(request: Request) {
  return (process.env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/workspace?google=not-configured", baseUrl(request)));
  }
  const url = new URL(request.url);
  const requestedCategory = url.searchParams.get("category") ?? "student";
  const category = ["student", "employee", "self-employed"].includes(requestedCategory) ? requestedCategory : "student";
  const state = randomBytes(32).toString("base64url");
  const callback = `${baseUrl(request)}/api/auth/google/callback`;
  const destination = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  destination.searchParams.set("client_id", clientId);
  destination.searchParams.set("redirect_uri", callback);
  destination.searchParams.set("response_type", "code");
  destination.searchParams.set("scope", "openid email profile");
  destination.searchParams.set("state", state);
  destination.searchParams.set("access_type", "online");
  const response = NextResponse.redirect(destination);
  response.cookies.set("av_google_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google/callback", maxAge: 600 });
  response.cookies.set("av_google_category", category, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google/callback", maxAge: 600 });
  return response;
}
