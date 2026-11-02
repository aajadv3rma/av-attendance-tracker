import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CalendarDays, Clock3, GraduationCap, LockKeyhole, Sparkles } from "lucide-react";

export const metadata = {
  title: "About AV Attendance Tracker",
  description: "Learn about AV Attendance Tracker, a focused attendance and work-time platform by Aajad Verma.",
};

export default function AboutPage() {
  return (
    <main className="about-page">
      <header className="landing-header shell-width"><Link className="brand-lockup" href="/"><span className="brand-mark">AV</span><span className="brand-name">AV <span>Attendance Tracker</span></span></Link><Link className="button button-dark button-small" href="/workspace">Open workspace <ArrowUpRight size={15} /></Link></header>
      <div className="about-content shell-width">
        <Link className="back-link" href="/"><ArrowLeft size={15} /> Back to home</Link>
        <span className="section-kicker">ABOUT THE PLATFORM</span>
        <h1>Time is personal.<br /><span>Tracking it should be, too.</span></h1>
        <p className="about-lede">AV Attendance Tracker brings attendance, shifts, and flexible work sessions together in one private workspace — shaped around the way you learn and work.</p>
        <div className="about-values"><article><span><GraduationCap size={20} /></span><h2>For students</h2><p>Manage subjects and class-by-class attendance. Follow your targets and understand how future classes affect your percentage.</p></article><article><span><Clock3 size={20} /></span><h2>For employees</h2><p>Keep shift, break, work-time, and overtime records with support for overnight schedules and clearly explained calculations.</p></article><article><span><Sparkles size={20} /></span><h2>For independent work</h2><p>Track flexible work sessions, breaks, project time, and personal goals without needing a fixed shift.</p></article></div>
        <section className="about-block"><div><span className="section-kicker">WHAT YOU CAN DO</span><h2>One practical place<br />to see your time.</h2></div><ul><li><CalendarDays size={17} /> Review attendance in calendar and history views.</li><li><Clock3 size={17} /> Record check-ins, check-outs, and multiple breaks.</li><li><Sparkles size={17} /> Set individual targets, schedules, and working preferences.</li><li><ArrowUpRight size={17} /> Export a copy of your records for your own use.</li></ul></section>
        <section className="about-privacy"><div className="privacy-icon"><LockKeyhole size={22} /></div><div><span className="section-kicker">PRIVACY & SECURITY</span><h2>Your workspace belongs to you.</h2><p>Sign-in sessions are stored as secure, revocable tokens. Attendance, subjects, shifts, projects, and settings are queried and written with the signed-in account as the owner. Passwords are salted and hashed; the application never returns password hashes to the browser. You can export your account data or permanently remove your account and its associated records.</p><p>Internet access is needed to synchronize with the application database. Email verification and password-reset delivery require the deployment owner to configure an email provider; without that setup, the application does not claim an email was sent.</p></div></section>
        <section className="about-block about-developer"><div><span className="section-kicker">THE PERSON BEHIND AV</span><h2>Made with care<br />by Aajad Verma.</h2></div><p>AV Attendance Tracker is designed to make everyday attendance and work-time information easier to record and understand. The goal is a useful, adaptable tool that respects the fact that people have different kinds of days.</p></section>
        <section className="about-version"><div><span className="section-kicker">PRODUCT DETAILS</span><h2>AV Attendance Tracker</h2><p>Version 0.1.0 · Web application</p></div><div><span className="section-kicker">SUPPORT</span><p>For account or deployment support, contact the administrator or support contact provided by the organization hosting your instance.</p></div></section>
        <div className="about-cta"><div><h2>Make room for a clearer view.</h2><p>Start with the tools that fit your day.</p></div><Link className="button button-dark" href="/workspace?auth=register">Create your workspace <ArrowUpRight size={16} /></Link></div>
      </div>
      <footer className="landing-footer shell-width"><Link className="brand-lockup" href="/"><span className="brand-mark">AV</span><span className="brand-name">AV <span>Attendance Tracker</span></span></Link><div className="footer-note">Thoughtfully built for everyday attendance and work. <span>© {new Date().getFullYear()} AV Attendance Tracker</span></div><Link href="/">Home</Link></footer>
    </main>
  );
}
