import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  Clock3,
  GraduationCap,
  LockKeyhole,
  Sparkles,
  Timer,
  UsersRound,
  WalletCards,
  Zap,
} from "lucide-react";

function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link className={`brand-lockup ${light ? "brand-lockup-light" : ""}`} href="/" aria-label="AV Attendance Tracker home">
      <span className="brand-mark">AV</span>
      <span className="brand-name">AV <span>Attendance Tracker</span></span>
    </Link>
  );
}

function MiniChart() {
  const heights = [32, 46, 39, 63, 56, 78, 66, 91, 73, 84, 69, 98, 82, 92];
  return (
    <div className="preview-chart" aria-label="Illustrative weekly work hours chart">
      {heights.map((height, index) => (
        <span key={index} className={index === 11 ? "preview-bar preview-bar-current" : "preview-bar"} style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="landing-page">
      <header className="landing-header shell-width">
        <Brand />
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#who-its-for">Who it’s for</a>
          <Link href="/about">About</Link>
        </nav>
        <div className="landing-header-actions">
          <Link className="header-login" href="/workspace">Log in</Link>
          <Link className="button button-dark button-small" href="/workspace?auth=register">Get started <ArrowUpRight size={15} /></Link>
        </div>
      </header>

      <section className="hero-section shell-width">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> A calmer way to keep track of time</div>
          <h1>Make every<br />hour <span>count.</span></h1>
          <p className="hero-description">Classes, shifts, or your own thing. Keep your attendance and working hours in one clear, considered space.</p>
          <div className="hero-actions">
            <Link className="button button-dark" href="/workspace?auth=register">Create your free workspace <ArrowRight size={17} /></Link>
            <a className="text-action" href="#how-it-works">See how it works <ArrowDownRight size={16} /></a>
          </div>
          <div className="hero-proof"><div className="avatar-stack"><span>A</span><span>V</span><span>+</span></div><p>Made for real days, not just timesheets.</p></div>
        </div>

        <div className="hero-visual" aria-label="Product preview">
          <div className="preview-orbit preview-orbit-one" /><div className="preview-orbit preview-orbit-two" />
          <div className="dashboard-preview">
            <div className="preview-topbar"><div className="preview-brand"><span className="preview-logo">AV</span><span>My workspace</span></div><span className="preview-pill"><i /> TODAY</span></div>
            <div className="preview-heading"><div><span className="preview-date">MONDAY, 12 MAY</span><h2>Good morning, Alex</h2></div><span className="preview-avatar">A</span></div>
            <div className="preview-kpis"><div className="preview-kpi preview-kpi-dark"><span>THIS WEEK</span><strong>32<span>h</span> 40<span>m</span></strong><small><span>↗ 8%</span> from last week</small></div><div className="preview-kpi"><span>ATTENDANCE</span><strong>94<span>%</span></strong><small><i className="small-green-dot" /> On track this month</small></div></div>
            <div className="preview-work-card"><div className="preview-work-header"><div><span className="preview-muted">YOUR WEEK</span><strong>Hours worked</strong></div><span className="preview-select">This week⌄</span></div><MiniChart /><div className="preview-days"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span></div></div>
            <div className="preview-session"><span className="preview-session-icon"><Clock3 size={16} /></span><div><strong>Work session</strong><span>Checked in at 9:02 AM</span></div><b>In progress</b></div>
          </div>
          <div className="floating-insight"><span className="insight-icon"><Sparkles size={16} /></span><div><small>YOUR WEEKLY RHYTHM</small><strong>Looking steady</strong></div><ArrowUpRight size={15} /></div>
          <div className="hero-caption"><span className="caption-line" /> A little more clarity, every day</div>
        </div>
      </section>

      <section className="trust-row shell-width"><span>ONE SIMPLE WORKSPACE FOR</span><div><span><GraduationCap size={17} /> Students</span><span><UsersRound size={16} /> Employees</span><span><Sparkles size={16} /> Independent work</span></div></section>

      <section className="section-intro shell-width" id="who-its-for">
        <div><span className="section-kicker">BUILT AROUND YOUR DAY</span><h2>Different days.<br /><span>One clear picture.</span></h2></div>
        <p>AV fits the way you actually work and learn — without forcing everyone into the same schedule.</p>
      </section>
      <section className="audience-grid shell-width">
        <article className="audience-card audience-student"><div className="audience-icon"><GraduationCap size={22} /></div><div className="card-index">01 / STUDENTS</div><h3>Stay ahead<br />of attendance.</h3><p>Keep class-by-class records, follow every subject, and see exactly how close you are to your goal.</p><Link href="/workspace?auth=register&category=student">Explore student tools <ArrowRight size={15} /></Link><div className="audience-mini student-mini"><div className="mini-attendance-ring"><span>86<small>%</small></span></div><div><small>SEMESTER ATTENDANCE</small><b>On the right track</b><span>12 classes until your target</span></div></div></article>
        <article className="audience-card audience-employee"><div className="audience-icon"><Clock3 size={21} /></div><div className="card-index">02 / EMPLOYEES</div><h3>Your shifts.<br />Counted right.</h3><p>Track fixed or rotating shifts, breaks, overnight work, and overtime with the math shown.</p><Link href="/workspace?auth=register&category=employee">Explore shift tools <ArrowRight size={15} /></Link><div className="audience-mini shift-mini"><div className="shift-mini-top"><span><i /> TODAY’S SHIFT</span><span>09:00 — 17:00</span></div><div className="shift-progress"><i /></div><div className="shift-mini-bottom"><span>6h 24m worked</span><b>+ 0h 24m OT</b></div></div></article>
        <article className="audience-card audience-independent"><div className="audience-icon"><Sparkles size={21} /></div><div className="card-index">03 / SELF-EMPLOYED</div><h3>Work flexibly.<br />See your rhythm.</h3><p>Track focus sessions, client projects, and personal goals — no fixed shift required.</p><Link href="/workspace?auth=register&category=self-employed">Explore flexible tools <ArrowRight size={15} /></Link><div className="audience-mini focus-mini"><div className="focus-total"><strong>24<span>h</span> 18<span>m</span></strong><small>FOCUSED THIS WEEK</small></div><div className="focus-dots"><i /><i /><i /><i /><i /><i /><i /></div><div className="focus-note">A little progress, every day.</div></div></article>
      </section>

      <section className="how-section" id="how-it-works"><div className="shell-width how-inner"><div className="how-copy"><span className="section-kicker">LESS ADMIN. MORE AWARENESS.</span><h2>Time tracking<br />that feels <span>human.</span></h2><p>Start with your category. Add the details that matter to you. Then let a clear, useful record take shape as you go.</p><Link className="button button-dark" href="/workspace?auth=register">Find your flow <ArrowRight size={17} /></Link></div><div className="how-steps"><div className="how-step"><span className="step-icon"><UsersRound size={19} /></span><div><small>01 — MAKE IT YOURS</small><h3>Choose your way of working</h3><p>Set up a student, employee, or independent workspace with relevant tools from day one.</p></div><span className="step-number">01</span></div><div className="how-step"><span className="step-icon"><Zap size={19} /></span><div><small>02 — KEEP A SIMPLE RECORD</small><h3>Mark a class, shift, or session</h3><p>A one-tap check-in or a quick class mark is all it takes to keep your history current.</p></div><span className="step-number">02</span></div><div className="how-step"><span className="step-icon"><BarChart3 size={19} /></span><div><small>03 — GET THE FULL PICTURE</small><h3>See your progress clearly</h3><p>Turn everyday entries into useful trends, attendance goals, and overtime breakdowns.</p></div><span className="step-number">03</span></div></div></div></section>

      <section className="feature-section shell-width" id="features"><div className="feature-heading"><span className="section-kicker">THE DETAILS, TAKEN CARE OF</span><h2>Useful tools. No busywork.</h2><p>Everything you need to stay on top of your time — without the clutter.</p></div><div className="feature-grid"><article><span className="feature-icon"><CalendarDays size={19} /></span><h3>A calendar that tells the story</h3><p>See classes, shifts, sessions, and days off in one glance. Open any date for the details.</p></article><article><span className="feature-icon"><Timer size={19} /></span><h3>Overtime you can understand</h3><p>Account for overnight shifts, breaks, and eligibility rules — with a clear formula for every total.</p></article><article><span className="feature-icon"><BarChart3 size={19} /></span><h3>Reports that make sense</h3><p>Follow daily, weekly, and monthly patterns. Export your own records when you need them.</p></article><article><span className="feature-icon"><LockKeyhole size={19} /></span><h3>Your records stay yours</h3><p>Private accounts, secure sessions, and data scoped to you. Export or delete your data when you choose.</p></article><article><span className="feature-icon"><WalletCards size={19} /></span><h3>Flexible goals and targets</h3><p>Set subject thresholds, work-hour targets, shift rules, or overtime estimates that fit your day.</p></article><article><span className="feature-icon"><Check size={19} /></span><h3>Made for the real world</h3><p>Mobile-ready, timezone-aware, and built to handle the small details that change the math.</p></article></div></section>

      <section className="privacy-strip shell-width"><div className="privacy-icon"><LockKeyhole size={22} /></div><div><span className="section-kicker">YOUR ACCOUNT. YOUR RECORDS.</span><h2>Private by design.</h2><p>Every workspace is private to its owner. Your attendance and work history are stored securely and only available after you sign in.</p></div><Link className="privacy-link" href="/about">Learn about AV <ArrowUpRight size={15} /></Link></section>

      <section className="faq-section shell-width"><div><span className="section-kicker">GOOD TO KNOW</span><h2>Questions,<br />answered.</h2><p>Need a hand? Read more on the <Link href="/about">About page</Link>.</p></div><div className="faq-list"><details><summary>Who can use AV Attendance Tracker?<span>+</span></summary><p>Students, employees with fixed or rotating shifts, and self-employed people can each create a workspace tailored to their needs.</p></details><details><summary>Can I change shifts and attendance rules?<span>+</span></summary><p>Yes. Employee accounts can create and edit shifts, scheduled payable hours, breaks, overtime eligibility, thresholds, and rounding. Students can set individual subject targets.</p></details><details><summary>How is overtime calculated?<span>+</span></summary><p>Overtime is calculated from your saved attendance, eligible work time, breaks, and chosen shift or threshold rules. Every record includes a calculation breakdown. Earnings are estimates, not payroll advice.</p></details><details><summary>Can I access my account on my phone?<span>+</span></summary><p>The interface adapts to mobile and desktop browsers. Your records synchronize through the application database when you are signed in and online.</p></details></div></section>

      <section className="final-cta shell-width"><div><span className="section-kicker">A CLEARER DAY STARTS HERE</span><h2>Your time, in good hands.</h2><p>Make a private workspace that works the way you do.</p></div><Link className="button button-light" href="/workspace?auth=register">Create your workspace <ArrowRight size={17} /></Link></section>

      <footer className="landing-footer shell-width"><Brand /><div className="footer-note">Thoughtfully built for everyday attendance and work. <span>© {new Date().getFullYear()} AV Attendance Tracker</span></div><div className="footer-links"><Link href="/about">About</Link><a href="mailto:support@avattendancetracker.com">Support</a><a href="#features">Features</a></div></footer>
    </main>
  );
}
