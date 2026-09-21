import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Icon from "./Icon";
import MessageText from "./MessageText";
import type { IconName } from "./Icon";
import { api, demoJobs, localRead, toolLabels } from "./data";
import type { CalendarEvent, Draft, Job, Message, Status, Trace } from "./data";
import "./App.css";

type Page = "Overview" | "All jobs" | "Saved jobs" | "Calendar" | "Email drafts";
const navigation: { label: Page; icon: IconName }[] = [
  { label: "Overview", icon: "grid" },
  { label: "All jobs", icon: "briefcase" },
  { label: "Saved jobs", icon: "bookmark" },
  { label: "Calendar", icon: "calendar" },
  { label: "Email drafts", icon: "mail" },
];
const initialStatus: Status = {
  connected: false,
  googleConfigured: false,
  aiConfigured: false,
};
const welcome = (live: boolean): Message => ({
  id: "welcome",
  role: "assistant",
  text: live
    ? "Your Gmail is connected. Tell me what kind of role you’re looking for, and I’ll search your job alerts, help you explore the details, and prepare email drafts."
    : "A fresh start, with a little help. Explore the sample jobs, or connect Gmail and tell me what your next role looks like. I’ll help you take it from there.",
});
function CompanyLogo({ company }: { company: string }) {
  const c = company.toLowerCase();
  return (
    <span
      className={`company-logo ${c.includes("linear") ? "linear" : c.includes("notion") ? "notion" : c.includes("vercel") ? "vercel" : c.includes("figma") ? "figma" : c.includes("loom") ? "loom" : "generic"}`}
      aria-hidden="true"
    >
      {c.includes("linear") ? (
        <span className="linear-mark" />
      ) : c.includes("vercel") ? (
        "▲"
      ) : c.includes("figma") ? (
        <span className="figma-mark">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : c.includes("loom") ? (
        "✺"
      ) : (
        company.charAt(0).toUpperCase()
      )}
    </span>
  );
}
function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function relativeDate(date: string) {
  const hours = Math.max(0, Math.floor((Date.now() - Number(date)) / 3600000));
  return hours < 1 ? "Just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [status, setStatus] = useState<Status>(initialStatus);
  const [jobs, setJobs] = useState<Job[]>(demoJobs);
  const [saved, setSaved] = useState<string[]>(
    localRead("culmin:demo:saved", ["demo-1", "demo-4"]),
  );
  const [drafts, setDrafts] = useState<Draft[]>(localRead("culmin:demo:drafts", []));
  const [events, setEvents] = useState<CalendarEvent[]>(localRead("culmin:demo:events", []));
  const [messages, setMessages] = useState<Message[]>([welcome(false)]);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [remote, setRemote] = useState(false);
  const [sort, setSort] = useState("newest");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [modal, setModal] = useState<"connect" | "event" | "draft" | null>(null);
  const [selected, setSelected] = useState<Job | null>(null);
  const [draft, setDraft] = useState({ to: "", subject: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(() =>
    new URLSearchParams(location.search).get("connection") === "denied"
      ? "Google access was not granted. You can connect again when you’re ready."
      : "",
  );
  const [now] = useState(() => Date.now());
  const [toast, setToast] = useState("");
  const [month, setMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [eventForm, setEventForm] = useState({
    title: "",
    date: dateKey(new Date()),
    time: "10:00",
    type: "Interview",
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const chatInput = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const live = status.connected;
  const scope = live ? `culmin:${status.email}` : "culmin:demo";

  useEffect(() => {
    let mounted = true;
    api<Status>("/status")
      .then(async (s) => {
        if (!mounted) return;
        setStatus(s);
        if (s.connected) {
          setJobs([]);
          setMessages([welcome(true)]);
          setSaved(localRead(`culmin:${s.email}:saved`, []));
          setEvents(localRead(`culmin:${s.email}:events`, []));
          const [jobData, draftData] = await Promise.all([
            api<{ jobs: Job[] }>("/jobs"),
            api<{ drafts: Draft[] }>("/drafts"),
          ]);
          if (mounted) {
            setJobs(jobData.jobs);
            setDrafts(draftData.drafts);
          }
        }
      })
      .catch(() => {
        if (mounted) setToast("Demo workspace · Start the backend to connect Google.");
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  useEffect(() => {
    if (!modal && !selected) return;
    const previous = document.activeElement as HTMLElement;
    const timer = setTimeout(
      () => modalRef.current?.querySelector<HTMLElement>("button, input, textarea")?.focus(),
      0,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        setModal(null);
        setSelected(null);
      }
      if (e.key === "Tab") {
        const nodes = modalRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input, select, textarea",
        );
        if (!nodes?.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes[nodes.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [modal, selected, saving]);

  function navigate(p: Page) {
    setPage(p);
    setSearch("");
    setMobileNav(false);
  }
  function saveJob(id: string) {
    const next = saved.includes(id) ? saved.filter((s) => s !== id) : [...saved, id];
    setSaved(next);
    localStorage.setItem(`${scope}:saved`, JSON.stringify(next));
  }
  async function refreshJobs(query = "") {
    setSyncing(true);
    setError("");
    try {
      if (!live) {
        setJobs(demoJobs);
        setToast("Sample jobs refreshed. Connect Gmail to discover your own alerts.");
        return;
      }
      const result = await api<{
        jobs: Job[];
        failed: number;
        hasMore: boolean;
      }>("/tools", { name: "search_jobs", arguments: { query } });
      const all = await api<{ jobs: Job[] }>("/jobs");
      setJobs(all.jobs);
      setToast(
        `Found ${result.jobs.length} Gmail alerts.${result.hasMore ? " More are available; refine your search." : ""}${result.failed ? ` ${result.failed} could not be loaded.` : ""}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  async function openJob(job: Job) {
    setSelected(job);
    if (live)
      try {
        const data = await api<{ job: Job }>("/tools", {
          name: "get_job",
          arguments: { job_id: job.id },
        });
        setSelected((current) => (current?.id === job.id ? data.job : current));
      } catch (e) {
        setError((e as Error).message);
      }
  }
  function compose(job?: Job) {
    setDraft({
      to: "",
      subject: job ? `Interest in ${job.title}` : "",
      body: job
        ? `Hello,\n\nI’m interested in the ${job.title} opportunity and would love to learn more about the role.\n\n[Add a short introduction and your relevant experience.]\n\nThank you for your time.\n\nBest,\n[Your name]`
        : "",
    });
    setSelected(null);
    setModal("draft");
  }
  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let created: Draft;
      if (live) {
        const result = await api<{ draft: Draft }>("/tools", {
          name: "create_email_draft",
          arguments: draft,
        });
        created = result.draft;
      } else {
        created = { ...draft, id: crypto.randomUUID() };
      }
      const next = [...drafts, created];
      setDrafts(next);
      if (!live) localStorage.setItem(`${scope}:drafts`, JSON.stringify(next));
      setModal(null);
      setToast(
        live ? "Draft created in Gmail. No email was sent." : "Demo draft saved in this browser.",
      );
      setPage("Email drafts");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function sendMessage(text = input) {
    if (!text.trim() || busy) return;
    setInput("");
    setBusy(true);
    setChatOpen(true);
    setError("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: text.trim() }]);
    try {
      let answer: { message: string; trace?: Trace[] };
      if (live) {
        answer = await api("/chat", { message: text });
        const [a, b] = await Promise.all([
          api<{ jobs: Job[] }>("/jobs"),
          api<{ drafts: Draft[] }>("/drafts"),
        ]);
        setJobs(a.jobs);
        setDrafts(b.drafts);
      } else {
        const query = text.toLowerCase();
        if (/draft|email|reach out/.test(query)) {
          compose(demoJobs[0]);
          answer = {
            message:
              "I’ve opened a sample draft for the Product Engineer role. Add a recipient and your own experience, then save it locally. Connect Google to create drafts in Gmail.",
          };
        } else if (/calendar|interview|schedule/.test(query)) {
          setPage("Calendar");
          answer = {
            message:
              "Here’s your interview planner. Choose “Add event” to plan an interview or follow-up. Events stay in this browser; Google Calendar sync isn’t enabled.",
          };
        } else if (/remote/.test(query)) {
          setRemote(true);
          setPage("All jobs");
          answer = {
            message:
              "I’ve filtered the sample opportunities to remote roles. There are examples at Linear, Vercel, Loom, and Raycast. Connect Gmail to search real alerts using your preferences.",
          };
        } else {
          setPage("All jobs");
          setRemote(false);
          answer = {
            message:
              "Here are six sample opportunities to explore. Open a role to see its details, bookmark it for later, or prepare a draft. Once you connect Gmail and configure AI, I can search your actual job alerts and help you compare roles.",
          };
        }
      }
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: answer.message,
          trace: answer.trace,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: (e as Error).message,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    try {
      const s = await api<Status>("/status");
      setStatus(s);
      if (s.googleConfigured) window.location.assign("/api/auth/google");
      else
        setError(
          "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env, then restart the backend.",
        );
    } catch {
      setError("Start the backend with cargo run in the backend folder, then try again.");
    }
  }
  async function disconnect() {
    setSaving(true);
    try {
      const result = await api<{ revoked: boolean }>("/auth/disconnect", {});
      setStatus((s) => ({ ...s, connected: false, email: undefined }));
      setJobs(demoJobs);
      setMessages([welcome(false)]);
      setSaved(localRead("culmin:demo:saved", ["demo-1", "demo-4"]));
      setEvents(localRead("culmin:demo:events", []));
      setDrafts(localRead("culmin:demo:drafts", []));
      setModal(null);
      setToast(
        result.revoked
          ? "Google disconnected."
          : "Signed out locally. You can revoke access in your Google Account settings.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const visibleJobs = jobs
    .filter(
      (j) =>
        (page !== "Saved jobs" || saved.includes(j.id)) &&
        (!remote || `${j.location} ${j.description}`.toLowerCase().includes("remote")) &&
        `${j.title} ${j.company} ${j.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "company" ? a.company.localeCompare(b.company) : Number(b.date) - Number(a.date),
    );
  const upcoming = [...events]
    .filter((e) => e.date >= dateKey(new Date()))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(month.getFullYear(), month.getMonth(), i - ((month.getDay() + 6) % 7) + 1),
  );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-visible" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-symbol">
            <Icon name="sparkles" size={23} />
          </span>
          culmin<span className="brand-dot">.</span>
        </a>
        <button className="workspace-picker" onClick={() => setModal("connect")}>
          <span className="workspace-avatar">Y</span>
          <span>
            Your workspace<small>Personal workspace</small>
          </span>
          <Icon name="chevron" size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.label}
              className={`nav-item ${page === n.label ? "active" : ""}`}
              onClick={() => navigate(n.label)}
            >
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
              {n.label === "All jobs" && <span className="nav-count">{jobs.length}</span>}
              {n.label === "Email drafts" && drafts.length > 0 && (
                <span className="nav-count">{drafts.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className="google-letter">G</span>
            <strong>{live ? "Gmail connected" : "Your inbox, working for you."}</strong>
            <p>
              {live
                ? "Your next opportunity could already be in your inbox."
                : "Turn your job alerts into your next opportunity."}
            </p>
            <button onClick={() => setModal("connect")}>
              {live ? "Manage connection" : "Connect Google"}
              <Icon name="arrow" size={15} />
            </button>
          </div>
          <button className="nav-item settings" onClick={() => setModal("connect")}>
            <Icon name="settings" size={19} />
            <span>Settings & connections</span>
          </button>
          <div className="user-profile">
            <span className="user-avatar">Y</span>
            <div>
              <strong>{live ? status.email?.split("@")[0] : "Your personal space"}</strong>
              <small>{live ? "Google account connected" : "Let’s find what’s next"}</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Icon name="menu" />
            </button>
            <span>Workspace</span>
            <Icon name="chevron" size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection-status ${live ? "connected" : ""}`}>
              <i />
              {live ? "Gmail connected" : "Demo workspace"}
            </span>
            <button
              className="icon-button"
              aria-label="Open connections"
              onClick={() => setModal("connect")}
            >
              <Icon name="sliders" size={18} />
            </button>
            <span className="top-avatar">Y</span>
          </div>
        </header>
        <div className="workspace-body">
          <main className="main-content">
            <div className="page-heading">
              <div className="eyebrow">A LITTLE MOMENTUM, EVERY DAY</div>
              <div className="heading-row">
                <h1>
                  {page === "Overview"
                    ? "Your next chapter starts here."
                    : page === "All jobs"
                      ? "Find your next opportunity."
                      : page === "Saved jobs"
                        ? "The ones worth a second look."
                        : page === "Calendar"
                          ? "Make room for what’s next."
                          : "Good conversations start here."}
                </h1>
                {page === "Calendar" ? (
                  <button className="button primary" onClick={() => setModal("event")}>
                    <Icon name="plus" size={16} />
                    Add event
                  </button>
                ) : page === "Email drafts" ? (
                  <button className="button primary" onClick={() => compose()}>
                    <Icon name="plus" size={16} />
                    New draft
                  </button>
                ) : (
                  <button
                    className="button secondary refresh-button"
                    disabled={syncing}
                    onClick={() => refreshJobs()}
                  >
                    <Icon name="refresh" size={15} className={syncing ? "spin" : ""} />
                    {syncing ? "Searching…" : "Refresh jobs"}
                  </button>
                )}
              </div>
              <p>
                {page === "Overview"
                  ? "A clearer view of your job search. A little less busywork."
                  : page === "Calendar"
                    ? "Interviews, follow-ups, and the steps in between. Saved in this browser."
                    : page === "Email drafts"
                      ? "Thoughtful outreach, ready for your finishing touches."
                      : "Explore your opportunities and keep the right ones close."}
              </p>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}
            {page === "Overview" && (
              <>
                <div className="stats-grid">
                  <button className="stat-card" onClick={() => navigate("All jobs")}>
                    <span className="stat-top">
                      Opportunities
                      <span className="stat-icon mint">
                        <Icon name="briefcase" size={17} />
                      </span>
                    </span>
                    <span className="stat-value">
                      {jobs.length}
                      <span className="stat-note">
                        {live ? "from your inbox" : "ready to explore"}
                      </span>
                    </span>
                    <span className="stat-caption">
                      {live ? "Discovered Gmail alerts" : "Sample opportunities"}
                      <Icon name="arrow" size={14} />
                    </span>
                  </button>
                  <button className="stat-card" onClick={() => navigate("Saved jobs")}>
                    <span className="stat-top">
                      Saved for later
                      <span className="stat-icon lavender">
                        <Icon name="bookmark" size={17} />
                      </span>
                    </span>
                    <span className="stat-value">
                      {saved.filter((id) => jobs.some((j) => j.id === id)).length}
                      <span className="stat-note">on your shortlist</span>
                    </span>
                    <span className="stat-caption">
                      A few promising possibilities
                      <Icon name="arrow" size={14} />
                    </span>
                  </button>
                  <button className="stat-card" onClick={() => navigate("Email drafts")}>
                    <span className="stat-top">
                      Email drafts
                      <span className="stat-icon peach">
                        <Icon name="mail" size={17} />
                      </span>
                    </span>
                    <span className="stat-value">
                      {drafts.length}
                      <span className="stat-note">ready when you are</span>
                    </span>
                    <span className="stat-caption">
                      Your next conversation
                      <Icon name="arrow" size={14} />
                    </span>
                  </button>
                </div>
                <div className="discovery-banner">
                  <div className="banner-art">
                    <Icon name="sparkles" size={26} />
                    <span />
                    <i />
                  </div>
                  <div>
                    <h3>Your search. A helpful head start.</h3>
                    <p>Tell your agent what you’re looking for. Let’s find the possibilities.</p>
                  </div>
                  <button
                    onClick={() => {
                      setChatOpen(true);
                      chatInput.current?.focus();
                    }}
                    aria-label="Start chatting with your agent"
                  >
                    <Icon name="arrow" size={20} />
                  </button>
                </div>
              </>
            )}
            {(page === "Overview" || page === "All jobs" || page === "Saved jobs") && (
              <section className="jobs-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      {page === "Saved jobs"
                        ? "Your shortlist"
                        : page === "Overview"
                          ? "On your radar"
                          : "All opportunities"}
                      <span className="count-pill">{visibleJobs.length}</span>
                    </h2>
                    <p>
                      {live
                        ? "Job alerts discovered in your Gmail inbox"
                        : "A preview of what your job search could look like"}
                    </p>
                  </div>
                  {page === "Overview" && (
                    <button className="text-button" onClick={() => navigate("All jobs")}>
                      View all jobs
                      <Icon name="arrow" size={15} />
                    </button>
                  )}
                </div>
                <div className="job-toolbar">
                  <label className="search-box">
                    <Icon name="search" size={17} />
                    <input
                      aria-label="Filter jobs"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search roles or companies…"
                    />
                    {search && (
                      <button
                        className="icon-button"
                        aria-label="Clear search"
                        onClick={() => setSearch("")}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </label>
                  <button
                    className={`filter-button ${remote ? "chosen" : ""}`}
                    onClick={() => setRemote(!remote)}
                  >
                    <Icon name="globe" size={15} />
                    Remote{remote && <Icon name="check" size={13} />}
                  </button>
                  <label className="sort-select">
                    <Icon name="filter" size={16} />
                    <select
                      aria-label="Sort jobs"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="newest">Newest first</option>
                      <option value="company">Company A–Z</option>
                    </select>
                  </label>
                </div>
                <div className="job-list">
                  {visibleJobs.slice(0, page === "Overview" ? 4 : undefined).map((job) => (
                    <article className="job-card" key={job.id}>
                      <CompanyLogo company={job.company} />
                      <div className="job-info">
                        <div className="job-title-row">
                          <button className="job-title" onClick={() => openJob(job)}>
                            {job.title}
                          </button>
                          {Number(job.date) > now - 86400000 && (
                            <span className="new-badge">NEW</span>
                          )}
                        </div>
                        <div className="job-company">
                          {job.company}
                          <span>·</span>
                          {job.location || "Gmail job alert"}
                        </div>
                        <div className="job-tags">
                          {job.tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                          {job.salary && <span className="salary">{job.salary}</span>}
                        </div>
                      </div>
                      <div className="job-side">
                        <button
                          className={`icon-button bookmark-button ${saved.includes(job.id) ? "is-saved" : ""}`}
                          onClick={() => saveJob(job.id)}
                          aria-label={`${saved.includes(job.id) ? "Unsave" : "Save"} ${job.title}`}
                          aria-pressed={saved.includes(job.id)}
                        >
                          <Icon name="bookmark" size={18} />
                        </button>
                        <span>{relativeDate(job.date)}</span>
                      </div>
                    </article>
                  ))}
                </div>
                {!visibleJobs.length && (
                  <div className="empty-state">
                    <Icon name={page === "Saved jobs" ? "bookmark" : "search"} size={32} />
                    <h3>
                      {search || remote
                        ? "No matching opportunities"
                        : page === "Saved jobs"
                          ? "Your shortlist starts here"
                          : "Your inbox has possibilities"}
                    </h3>
                    <p>
                      {search || remote
                        ? "Try a different search or clear the remote filter."
                        : page === "Saved jobs"
                          ? "Bookmark a role to come back to it later."
                          : "Refresh jobs or ask your agent to search your Gmail alerts."}
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setSearch("");
                        setRemote(false);
                        if (page === "Saved jobs") navigate("All jobs");
                        else if (!jobs.length) refreshJobs();
                      }}
                    >
                      {search || remote
                        ? "Clear filters"
                        : page === "Saved jobs"
                          ? "Explore jobs"
                          : "Search Gmail"}
                    </button>
                  </div>
                )}
                <div className="list-footer">
                  <span>
                    <span className={`tiny-dot ${live ? "green" : ""}`} />
                    {live
                      ? "Sourced from your Gmail · Up to 20 alerts per search"
                      : "Sample data · Connect Gmail to make this yours"}
                  </span>
                  <span>
                    {Math.min(visibleJobs.length, page === "Overview" ? 4 : visibleJobs.length)} of{" "}
                    {visibleJobs.length} opportunities
                  </span>
                </div>
              </section>
            )}
            {page === "Overview" && (
              <section className="upcoming-section">
                <div className="section-heading">
                  <h2>Coming up</h2>
                  <button className="text-button" onClick={() => navigate("Calendar")}>
                    Open calendar
                    <Icon name="arrow" size={15} />
                  </button>
                </div>
                {upcoming.length ? (
                  upcoming.slice(0, 2).map((event) => (
                    <div className="upcoming-event" key={event.id}>
                      <span className="event-date">
                        {new Date(event.date + "T12:00").toLocaleDateString(undefined, {
                          month: "short",
                        })}
                        <strong>{Number(event.date.slice(-2))}</strong>
                      </span>
                      <div>
                        <strong>{event.title}</strong>
                        <p>
                          {event.type} · {event.time}
                        </p>
                      </div>
                      <Icon name="chevron" size={17} />
                    </div>
                  ))
                ) : (
                  <div className="upcoming-empty">
                    <span className="calendar-illustration">
                      <Icon name="calendar" size={26} />
                    </span>
                    <div>
                      <strong>A little breathing room.</strong>
                      <p>No upcoming events. Add an interview or a follow-up when you’re ready.</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Add calendar event"
                      onClick={() => setModal("event")}
                    >
                      <Icon name="plus" size={20} />
                    </button>
                  </div>
                )}
              </section>
            )}
            {page === "Calendar" && (
              <section className="calendar-panel">
                <div className="calendar-heading">
                  <h2>
                    {month.toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    })}
                  </h2>
                  <div>
                    <button
                      className="button secondary"
                      onClick={() =>
                        setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
                      }
                    >
                      Today
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Previous month"
                      onClick={() =>
                        setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
                      }
                    >
                      <Icon name="chevron" className="rotate" />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Next month"
                      onClick={() =>
                        setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
                      }
                    >
                      <Icon name="chevron" />
                    </button>
                  </div>
                </div>
                <div className="calendar-weekdays">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                <div className="calendar-grid">
                  {days.map((day) => (
                    <div
                      className={`calendar-day ${day.getMonth() !== month.getMonth() ? "muted" : ""}`}
                      key={dateKey(day)}
                    >
                      <button
                        className={dateKey(day) === dateKey(new Date()) ? "today-number" : ""}
                        aria-label={`Add event on ${day.toLocaleDateString()}`}
                        onClick={() => {
                          setEventForm((f) => ({ ...f, date: dateKey(day) }));
                          setModal("event");
                        }}
                      >
                        {day.getDate()}
                      </button>
                      {events
                        .filter((e) => e.date === dateKey(day))
                        .map((event) => (
                          <button
                            className="calendar-event"
                            title={`${event.title} · ${event.time} — click to view`}
                            key={event.id}
                            onClick={() =>
                              setToast(`${event.title} · ${event.date} at ${event.time}`)
                            }
                          >
                            {event.time} {event.title}
                          </button>
                        ))}
                    </div>
                  ))}
                </div>
                <div className="calendar-note">
                  <Icon name="pin" size={15} />
                  Your timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone} · Local planner
                </div>
                {upcoming.map((event) => (
                  <div className="event-list-item" key={event.id}>
                    <Icon name="calendar" size={17} />
                    <div>
                      <strong>{event.title}</strong>
                      <p>
                        {event.date} · {event.time} · {event.type}
                      </p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Delete ${event.title}`}
                      onClick={() => {
                        const next = events.filter((e) => e.id !== event.id);
                        setEvents(next);
                        localStorage.setItem(`${scope}:events`, JSON.stringify(next));
                      }}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ))}
              </section>
            )}
            {page === "Email drafts" && (
              <section className="drafts-section">
                {!drafts.length ? (
                  <div className="empty-state draft-empty">
                    <span className="large-icon">
                      <Icon name="mail" size={30} />
                    </span>
                    <h3>Your next conversation is a draft away.</h3>
                    <p>
                      Ask your agent to help with an introduction, or start with your own words.
                    </p>
                    <button className="button primary" onClick={() => compose()}>
                      <Icon name="plus" size={16} />
                      Create a draft
                    </button>
                  </div>
                ) : (
                  drafts.map((d) => (
                    <article className="draft-card" key={d.id}>
                      <span className="draft-label">
                        <Icon name="mail" size={15} />
                        {live ? "GMAIL DRAFT" : "LOCAL DEMO DRAFT"}
                      </span>
                      <h3>{d.subject}</h3>
                      <p className="draft-recipient">To: {d.to}</p>
                      <p className="draft-body">{d.body}</p>
                      {d.url ? (
                        <a className="text-button" href={d.url} target="_blank" rel="noreferrer">
                          Review in Gmail
                          <Icon name="external" size={14} />
                        </a>
                      ) : (
                        <button
                          className="text-button"
                          onClick={() => {
                            navigator.clipboard
                              .writeText(d.body)
                              .then(() => setToast("Draft copied."))
                              .catch(() =>
                                setError(
                                  "Could not copy. Select the draft text to copy it manually.",
                                ),
                              );
                          }}
                        >
                          Copy draft
                          <Icon name="mail" size={14} />
                        </button>
                      )}
                    </article>
                  ))
                )}
              </section>
            )}
            <footer className="main-footer">
              <span className="mini-brand">
                <Icon name="sparkles" size={13} />A little clarity. A lot of possibility.
              </span>
              <span>Made for your next chapter.</span>
            </footer>
          </main>
          <aside className={`agent-panel ${chatOpen ? "chat-mobile-open" : ""}`}>
            <div className="agent-header">
              <span className="agent-avatar">
                <Icon name="sparkles" size={21} />
              </span>
              <div>
                <h2>Your job search agent</h2>
                <p>
                  <i />
                  {live && status.aiConfigured
                    ? "Ready to help"
                    : live
                      ? "AI setup needed"
                      : "Explore in demo mode"}
                </p>
              </div>
              <button
                className="icon-button close-chat"
                aria-label="Close chat"
                onClick={() => setChatOpen(false)}
              >
                <Icon name="close" size={18} />
              </button>
              <span className="agent-label">CULMIN AI</span>
            </div>
            <div className="agent-chat">
              <div className="agent-intro">
                <div className="orbit-logo">
                  <Icon name="sparkles" size={29} />
                  <i />
                  <span />
                </div>
                <h3>
                  A good next step
                  <br />
                  starts with a conversation.
                </h3>
                <p>Your possibilities, with a little perspective.</p>
              </div>
              <div className="messages" aria-live="polite">
                {messages.map((m) => (
                  <div className={`message ${m.role}`} key={m.id}>
                    {m.role === "assistant" && (
                      <span className="message-avatar">
                        <Icon name="sparkles" size={13} />
                      </span>
                    )}
                    <div>
                      <div className="message-text">
                        <MessageText text={m.text} />
                      </div>
                      {m.trace && m.trace.length > 0 && (
                        <div className="tool-traces">
                          {m.trace.map((t, i) => (
                            <div key={i}>
                              <Icon name={t.success ? "check" : "close"} size={13} />
                              {toolLabels[t.tool] || t.tool}
                              {t.count !== undefined && t.count !== null ? ` · ${t.count}` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="thinking">
                    <span />
                    <span />
                    <span />
                    <small>Working on your next step…</small>
                  </div>
                )}
                <div ref={bottom} />
              </div>
              {messages.length === 1 && (
                <div className="suggestions">
                  <span>A FEW PLACES TO START</span>
                  {[
                    { text: "Find remote engineering roles", icon: "search" },
                    { text: "Help me draft an introduction", icon: "mail" },
                    { text: "Show me my opportunities", icon: "briefcase" },
                  ].map((s) => (
                    <button key={s.text} onClick={() => sendMessage(s.text)}>
                      <Icon name={s.icon as IconName} size={16} />
                      {s.text}
                      <Icon name="arrow" size={14} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="composer-area">
              <div className="context-chip">
                <Icon name={live ? "mail" : "globe"} size={13} />
                {live ? "Gmail workspace" : "Sample workspace"}
                <span>4 tools</span>
              </div>
              <form
                className="chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
              >
                <textarea
                  ref={chatInput}
                  aria-label="Message your job search agent"
                  placeholder="What does your next role look like?"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <div>
                  <span>
                    <Icon name="sparkles" size={13} />
                    {live ? "Your inbox. Your possibilities." : "Try a conversation"}
                  </span>
                  <button
                    type="submit"
                    className="send-button"
                    aria-label="Send message"
                    disabled={busy || !input.trim()}
                  >
                    <Icon name="arrow" size={19} />
                  </button>
                </div>
              </form>
              <p className="composer-note">
                {live
                  ? "Email drafts only. You’re always in control."
                  : "Demo responses · Connect Gmail to get started."}
              </p>
            </div>
          </aside>
        </div>
      </div>
      <button className="mobile-agent-button" onClick={() => setChatOpen(!chatOpen)}>
        <Icon name="sparkles" size={18} />
        Ask Culmin
      </button>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {(modal || selected) && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) {
              setModal(null);
              setSelected(null);
            }
          }}
        >
          <div
            className={`modal ${selected ? "job-detail-modal" : ""}`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              disabled={saving}
              onClick={() => {
                setModal(null);
                setSelected(null);
              }}
            >
              <Icon name="close" />
            </button>
            {selected ? (
              <>
                <CompanyLogo company={selected.company} />
                <span className="detail-eyebrow">
                  {live ? "FROM YOUR GMAIL" : "SAMPLE OPPORTUNITY"}
                </span>
                <h2 id="modal-title">{selected.title}</h2>
                <p className="detail-company">{selected.company}</p>
                <div className="detail-meta">
                  {selected.location && (
                    <span>
                      <Icon name="pin" size={16} />
                      {selected.location}
                    </span>
                  )}
                  {selected.salary && <span>{selected.salary}</span>}
                </div>
                <div className="job-tags">
                  {selected.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <h3>{live ? "Original alert" : "About the opportunity"}</h3>
                <p className="job-description">{selected.description}</p>
                <div className="modal-actions">
                  <button className="button secondary" onClick={() => saveJob(selected.id)}>
                    <Icon name="bookmark" size={16} />
                    {saved.includes(selected.id) ? "Saved" : "Save job"}
                  </button>
                  {selected.sourceUrl && (
                    <a
                      href={selected.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="button secondary"
                    >
                      View in Gmail
                      <Icon name="external" size={14} />
                    </a>
                  )}
                  <button className="button primary" onClick={() => compose(selected)}>
                    <Icon name="mail" size={16} />
                    Draft an email
                  </button>
                </div>
              </>
            ) : modal === "connect" ? (
              <>
                <span className="connection-modal-icon google-letter">G</span>
                <h2 id="modal-title">
                  {live ? "Your Google connection" : "Your next role might be in your inbox."}
                </h2>
                <p className="modal-subtitle">
                  {live ? status.email : "Connect Google to give your agent a place to start."}
                </p>
                <div className="permissions-list">
                  <div>
                    <span className="stat-icon mint">
                      <Icon name="search" size={18} />
                    </span>
                    <div>
                      <strong>Find the possibilities</strong>
                      <p>Search and read job alerts in Gmail.</p>
                    </div>
                  </div>
                  <div>
                    <span className="stat-icon lavender">
                      <Icon name="mail" size={18} />
                    </span>
                    <div>
                      <strong>Get a conversation started</strong>
                      <p>Create drafts for you to review in Gmail.</p>
                    </div>
                  </div>
                  <div>
                    <span className="stat-icon peach">
                      <Icon name="check" size={18} />
                    </span>
                    <div>
                      <strong>You choose what goes out</strong>
                      <p>Culmin has no email-sending action.</p>
                    </div>
                  </div>
                </div>
                {!status.googleConfigured && (
                  <div className="setup-notice">
                    <strong>A one-time setup</strong>
                    <p>
                      Add Google OAuth credentials to <code>backend/.env</code>. Add an OpenAI API
                      key to enable the chat agent. Setup instructions are in the project README.
                    </p>
                  </div>
                )}
                <p className="privacy-note">
                  Google’s compose permission includes sending, but this app only creates drafts.
                  When you use the agent, relevant alert content is processed by OpenAI. Calendar
                  events stay in this browser.
                </p>
                {error && (
                  <div className="inline-error" role="alert">
                    {error}
                  </div>
                )}
                <button
                  className="button primary full-width"
                  disabled={saving}
                  onClick={live ? disconnect : connect}
                >
                  {live ? "Disconnect Google" : "Continue with Google"}
                  <Icon name={live ? "logout" : "arrow"} size={17} />
                </button>
              </>
            ) : modal === "draft" ? (
              <>
                <span className="detail-eyebrow">{live ? "GMAIL DRAFT" : "LOCAL DEMO DRAFT"}</span>
                <h2 id="modal-title">Start a good conversation.</h2>
                <p className="modal-subtitle">Make it yours. Nothing is sent from Culmin.</p>
                <form className="modal-form" onSubmit={saveDraft}>
                  <label>
                    To
                    <input
                      required
                      type="email"
                      placeholder="recruiter@company.com"
                      value={draft.to}
                      onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                    />
                  </label>
                  <label>
                    Subject
                    <input
                      required
                      maxLength={500}
                      placeholder="A quick introduction"
                      value={draft.subject}
                      onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    />
                  </label>
                  <label>
                    Message
                    <textarea
                      required
                      rows={10}
                      maxLength={30000}
                      placeholder="Hello…"
                      value={draft.body}
                      onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    />
                  </label>
                  {error && (
                    <div className="inline-error" role="alert">
                      {error}
                    </div>
                  )}
                  <button className="button primary full-width" disabled={saving}>
                    {saving ? "Creating draft…" : live ? "Create Gmail draft" : "Save demo draft"}
                    <Icon name="mail" size={16} />
                  </button>
                </form>
              </>
            ) : (
              <>
                <span className="detail-eyebrow">YOUR LOCAL PLANNER</span>
                <h2 id="modal-title">A step worth making time for.</h2>
                <form
                  className="modal-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const next = [...events, { ...eventForm, id: crypto.randomUUID() }];
                    setEvents(next);
                    localStorage.setItem(`${scope}:events`, JSON.stringify(next));
                    setModal(null);
                    setToast("Event added to your local planner.");
                    setEventForm({
                      title: "",
                      date: dateKey(new Date()),
                      time: "10:00",
                      type: "Interview",
                    });
                  }}
                >
                  <label>
                    Event title
                    <input
                      required
                      placeholder="Interview with the product team"
                      maxLength={120}
                      value={eventForm.title}
                      onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      Date
                      <input
                        required
                        type="date"
                        value={eventForm.date}
                        onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                      />
                    </label>
                    <label>
                      Time
                      <input
                        required
                        type="time"
                        value={eventForm.time}
                        onChange={(e) => setEventForm({ ...eventForm, time: e.target.value })}
                      />
                    </label>
                  </div>
                  <label>
                    Event type
                    <select
                      value={eventForm.type}
                      onChange={(e) => setEventForm({ ...eventForm, type: e.target.value })}
                    >
                      <option>Interview</option>
                      <option>Follow-up</option>
                      <option>Application deadline</option>
                      <option>Preparation</option>
                    </select>
                  </label>
                  <button className="button primary full-width">
                    Add to planner
                    <Icon name="plus" size={16} />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
