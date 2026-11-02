"use client";

import Link from "next/link";
import { ArrowLeft, Check, Clock3, GraduationCap, LockKeyhole, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { firebaseAuth, firebaseConfigured, googleProvider, provisionFirebaseSession } from "@/lib/firebase";

export type AccountCategory = "student" | "employee" | "self-employed";
export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  category: AccountCategory;
  timezone: string;
  avatarUrl?: string | null;
  profile?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
};

type AuthMode = "login" | "register" | "forgot" | "reset";

export default function AuthScreen({
  onAuthenticated,
  initialMode = "login",
  initialCategory = "student",
}: {
  onAuthenticated: (user: AuthUser) => void;
  initialMode?: AuthMode;
  initialCategory?: AccountCategory;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [category, setCategory] = useState<AccountCategory>(initialCategory);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [googleMessage, setGoogleMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authMode = params.get("auth");
    if (authMode === "register") setMode("register");
    const accountCategory = params.get("category");
    if (["student", "employee", "self-employed"].includes(accountCategory ?? "")) setCategory(accountCategory as AccountCategory);
    const token = params.get("token");
    if (token && window.location.pathname === "/reset-password") {
      setResetToken(token);
      setMode("reset");
    }
    const googleState = params.get("google");
    const messages: Record<string, string> = {
      "not-configured": "Google sign-in is not configured for this deployment. Use email and password, or ask the site administrator to add OAuth credentials.",
      "invalid-state": "Google sign-in could not be verified. Please try again.",
      "exchange-failed": "Google sign-in could not be completed. Please try again.",
      "profile-failed": "We could not retrieve your Google profile. Please try again.",
      "email-not-verified": "Google did not provide a verified email address.",
      "account-link-conflict": "This email is already linked to a different Google account. Sign in using your existing method.",
      unavailable: "Google sign-in is temporarily unavailable.",
      cancelled: "Google sign-in was cancelled.",
    };
    if (googleState && messages[googleState]) setGoogleMessage(messages[googleState]);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (mode === "reset" && password !== passwordConfirm) throw new Error("Your passwords do not match.");
      if (firebaseConfigured && firebaseAuth && mode !== "reset") {
        if (mode === "forgot") {
          await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
          setMessage("If an account exists, a password reset email has been sent.");
          return;
        }
        const credential = mode === "register"
          ? await createUserWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password)
          : await signInWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password);
        if (mode === "register") {
          await sendEmailVerification(credential.user);
          await signOut(firebaseAuth);
          setMode("login");
          setMessage("Account created. Verify your email, then sign in.");
          return;
        }
        if (!credential.user.emailVerified) throw new Error("Please verify your email address before signing in.");
        const user = await provisionFirebaseSession(credential.user, category, fullName);
        onAuthenticated(user as AuthUser);
        return;
      }
      const action = mode === "register" ? "register" : mode === "forgot" ? "forgot-password" : mode === "reset" ? "reset-password" : "login";
      const payload: Record<string, unknown> = { action, email, password };
      if (mode === "register") Object.assign(payload, { fullName, category });
      if (mode === "forgot") Object.assign(payload, { email });
      if (mode === "reset") Object.assign(payload, { token: resetToken });
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to complete this request.");
      if (mode === "login" || mode === "register") {
        onAuthenticated(data.user as AuthUser);
      } else if (mode === "forgot") {
        setMessage(data.message ?? "If this account exists, a reset link will be sent.");
      } else {
        setMessage(data.message ?? "Your password was reset.");
        setMode("login");
        setPassword("");
        setPasswordConfirm("");
        window.history.replaceState({}, "", "/workspace");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete this request.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "register" ? "Create your workspace" : mode === "forgot" ? "Reset your password" : mode === "reset" ? "Choose a new password" : "Welcome back";
  const subtitle = mode === "register" ? "A personal space for the way you learn or work." : mode === "forgot" ? "We’ll send a reset link if email delivery is configured." : mode === "reset" ? "Choose a strong password you haven’t used before." : "Sign in to pick up right where you left off.";

  return (
    <main className="auth-shell">
      <section className="auth-visual">
        <Link className="brand-lockup" href="/"><span className="brand-mark">AV</span><span className="brand-name">AV <span>Attendance Tracker</span></span></Link>
        <div className="auth-visual-copy">
          <span className="section-kicker">YOUR TIME, IN FOCUS</span>
          <h1>Make every<br />hour <span>count.</span></h1>
          <p>A quieter, clearer place to see your classes, shifts, and the work that fills your day.</p>
          <div className="auth-feature-list"><div><Check size={14} /> A dashboard designed around you</div><div><LockKeyhole size={14} /> Private, personal attendance records</div><div><Clock3 size={14} /> Shift and overtime calculations with context</div></div>
        </div>
        <div className="auth-footer">Thoughtfully built for everyday attendance and work.</div>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-card">
          <Link href="/" className="auth-back"><ArrowLeft size={13} /> Back to home</Link>
          <h2>{title}</h2>
          <p>{subtitle}</p>
          {googleMessage && <div className="auth-error" role="status">{googleMessage}</div>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          {message && <div className="auth-success" role="status">{message}</div>}
          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && <>
              <div className="form-field"><label htmlFor="fullName">Your name</label><input id="fullName" autoComplete="name" required minLength={2} maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Aajad Verma" /></div>
              <div className="form-field"><label htmlFor="category">I’m here as a</label><select id="category" value={category} onChange={(event) => setCategory(event.target.value as AccountCategory)}><option value="student">Student</option><option value="employee">Employee</option><option value="self-employed">Self-employed</option></select></div>
            </>}
            {mode !== "reset" && <div className="form-field"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></div>}
            {mode !== "forgot" && <div className="form-field"><label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</label><input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "login" ? "Your password" : "At least 8 characters"} /></div>}
            {mode === "reset" && <div className="form-field"><label htmlFor="passwordConfirm">Confirm new password</label><input id="passwordConfirm" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="Enter it again" /></div>}
            {mode === "login" && <div style={{ textAlign: "right", marginTop: -6 }}><button type="button" className="auth-switch" style={{ margin: 0, border: 0, background: "none", cursor: "pointer" }} onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>Forgot password?</button></div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Save new password" : "Sign in"}</button>
          </form>
          {(mode === "login" || mode === "register") && <>
            <div className="auth-divider">or continue with</div>
            {firebaseConfigured && firebaseAuth && googleProvider ? <button className="google-button" type="button" disabled={busy} onClick={async () => {
              setError("");
              setGoogleMessage("");
              setBusy(true);
              try {
                if (!firebaseAuth || !googleProvider) throw new Error("Firebase Authentication is not configured.");
                const credential = await signInWithPopup(firebaseAuth, googleProvider);
                const user = await provisionFirebaseSession(credential.user, category);
                onAuthenticated(user as AuthUser);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Unable to continue with Google.");
              } finally {
                setBusy(false);
              }
            }}><span className="google-letter">G</span> Continue with Google</button> : <a className="google-button" href={`/api/auth/google?category=${encodeURIComponent(category)}`}><span className="google-letter">G</span> Continue with Google</a>}
          </>}
          <div className="auth-switch">{mode === "register" ? <>Already have an account? <button type="button" onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Sign in</button></> : mode === "login" ? <>New to AV? <button type="button" onClick={() => { setMode("register"); setError(""); setMessage(""); }}>Create an account</button></> : <button type="button" onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Back to sign in</button>}</div>
          <div className="auth-note">By continuing, you create a private account for your own attendance records. Authentication is protected by Firebase when configured for this deployment.</div>
        </div>
      </section>
    </main>
  );
}
