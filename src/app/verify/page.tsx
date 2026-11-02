"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleHelp } from "lucide-react";

export default function VerifyEmailPage() {
  const [message, setMessage] = useState("Checking your verification link…");
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) { setMessage("This verification link is incomplete. Sign in and request a new verification email."); return; }
    fetch("/api/auth", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify-email", token }) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Unable to verify this address."); setSuccess(true); setMessage(body.message); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to verify this address."));
  }, []);
  return <main className="auth-shell"><section className="auth-visual"><Link className="brand-lockup" href="/"><span className="brand-mark">AV</span><span className="brand-name">AV <span>Attendance Tracker</span></span></Link><div className="auth-visual-copy"><span className="section-kicker">ACCOUNT SECURITY</span><h1>Your records,<br /><span>kept personal.</span></h1><p>Email verification helps protect the account connected to your attendance history.</p></div><div className="auth-footer">Thoughtfully built for everyday attendance and work.</div></section><section className="auth-form-wrap"><div className="auth-card"><Link href="/" className="auth-back"><ArrowLeft size={13} /> Back to home</Link><h2>{success ? "Email verified" : "Email verification"}</h2><p>{message}</p><div className={success ? "auth-success" : "auth-note"} role="status">{success ? <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginRight: 5 }} /> : <CircleHelp size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />}{message}</div><Link className="button button-dark" style={{ width: "100%", marginTop: 18 }} href="/workspace">Continue to workspace</Link></div></section></main>;
}
