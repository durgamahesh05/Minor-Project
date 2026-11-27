import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Users, FileText, ListChecks, Layers, MessageSquare, Trash2, ShieldCheck, ShieldOff, Shield, HardDrive,
  RefreshCw, Search, Activity, Database, Mail, KeyRound, Upload, Bot, Boxes,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import {
  api, type AdminStats, type AdminUser, type AdminDocument, type AdminQuiz, type AdminFlashcardSet, type AdminConversation, type AdminSystem,
} from "../lib/api";
import { isSlowConnection } from "../lib/studyCache";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";

type Tab = "users" | "documents" | "quizzes" | "flashcards" | "conversations" | "system";
type Rows = {
  users: AdminUser[]; documents: AdminDocument[]; quizzes: AdminQuiz[]; flashcards: AdminFlashcardSet[]; conversations: AdminConversation[];
};
const EMPTY_ROWS: Rows = { users: [], documents: [], quizzes: [], flashcards: [], conversations: [] };

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Stats refresh on their own: every 30s, every 2 min on slow connections, never while the tab is hidden. */
const refreshInterval = () => (isSlowConnection() ? 120_000 : 30_000);

export default function AdminPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === "auto" ? undefined : language;
  const date = (value: string) => new Date(value).toLocaleDateString(locale);

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [tab, setTab] = useState<Tab>("users");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<Rows>(EMPTY_ROWS);
  const [totals, setTotals] = useState<Partial<Record<Tab, number>>>({});
  const [system, setSystem] = useState<AdminSystem | null>(null);
  const requestId = useRef(0);

  const c = getThemeColors(theme);
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : t("admin.loadError"));

  const refreshStats = useCallback(async () => {
    try { setStats(await api.adminStats()); }
    catch (err) { fail(err); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live stats: periodic refresh paced by connection speed and page visibility.
  useEffect(() => {
    void refreshStats();
    let timer = 0;
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(tick, refreshInterval()); };
    const tick = () => { if (!document.hidden) void refreshStats(); schedule(); };
    const onVisible = () => { if (!document.hidden) { void refreshStats(); schedule(); } };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refreshStats]);

  // Search waits until typing pauses, so each keystroke does not hit the server.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadTab = useCallback(async (current: Tab, q: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      if (current === "system") {
        const value = await api.adminSystem();
        if (id === requestId.current) setSystem(value);
        return;
      }
      const result =
        current === "users" ? await api.adminListUsers(q).then(r => ({ total: r.total, items: r.users }))
        : current === "documents" ? await api.adminListDocuments(q).then(r => ({ total: r.total, items: r.documents }))
        : current === "quizzes" ? await api.adminListQuizzes(q).then(r => ({ total: r.total, items: r.quizzes }))
        : current === "flashcards" ? await api.adminListFlashcardSets(q).then(r => ({ total: r.total, items: r.sets }))
        : await api.adminListConversations(q).then(r => ({ total: r.total, items: r.conversations }));
      if (id !== requestId.current) return; // a newer tab/search already replaced this one
      setRows(previous => ({ ...previous, [current]: result.items }));
      setTotals(previous => ({ ...previous, [current]: result.total }));
    } catch (err) {
      if (id === requestId.current) fail(err);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadTab(tab, debouncedQuery); }, [tab, debouncedQuery, loadTab]);

  const refreshAll = async () => {
    setRefreshing(true);
    await Promise.all([refreshStats(), loadTab(tab, debouncedQuery)]);
    setRefreshing(false);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await refreshStats();
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const removeRow = (key: keyof Rows, id: string) => {
    setRows(previous => ({ ...previous, [key]: (previous[key] as { id: string }[]).filter(item => item.id !== id) }));
    setTotals(previous => ({ ...previous, [key]: Math.max(0, (previous[key] ?? 1) - 1) }));
  };

  const deleteUser = (target: AdminUser) => {
    if (!window.confirm(t("admin.confirmDeleteUser", { name: target.name || target.email }))) return;
    void runAction(target.id, async () => { await api.adminDeleteUser(target.id); removeRow("users", target.id); });
  };

  const toggleRole = (target: AdminUser) => {
    const role = target.role === "admin" ? "user" : "admin";
    void runAction(target.id, async () => {
      await api.adminSetUserRole(target.id, role);
      setRows(previous => ({ ...previous, users: previous.users.map(item => item.id === target.id ? { ...item, role } : item) }));
    });
  };

  const deleteItem = (key: Exclude<keyof Rows, "users">, id: string, name: string, remove: (id: string) => Promise<void>) => {
    if (!window.confirm(t("admin.confirmDelete", { name }))) return;
    void runAction(id, async () => { await remove(id); removeRow(key, id); });
  };

  const tabs: { id: Tab; icon: React.ElementType }[] = [
    { id: "users", icon: Users },
    { id: "documents", icon: FileText },
    { id: "quizzes", icon: ListChecks },
    { id: "flashcards", icon: Layers },
    { id: "conversations", icon: MessageSquare },
    { id: "system", icon: Activity },
  ];

  const statCards = stats
    ? [
        { label: t("admin.stats.users"), value: stats.totalUsers, hint: t("admin.stats.newThisWeek", { count: stats.newUsersThisWeek }), icon: Users },
        { label: t("admin.stats.admins"), value: stats.totalAdmins, icon: ShieldCheck },
        { label: t("admin.stats.documents"), value: stats.totalDocuments, hint: t("admin.stats.indexed", { count: stats.indexedDocuments }), icon: FileText },
        { label: t("admin.stats.storage"), value: formatSize(stats.storageBytes), icon: HardDrive },
        { label: t("admin.stats.quizzes"), value: stats.totalQuizzes, icon: ListChecks },
        { label: t("admin.stats.flashcardSets"), value: stats.totalFlashcardSets, icon: Layers },
        { label: t("admin.stats.conversations"), value: stats.totalConversations, hint: t("admin.stats.messages", { count: stats.totalMessages }), icon: MessageSquare },
      ]
    : [];

  const owner = (value: AdminDocument["owner"]) => (value ? `${value.name} (${value.email})` : t("admin.unknownOwner"));
  const rowStyle = { background: c.chipBg, border: `1px solid ${c.chipBorder}` };
  const deleteButton = (title: string, id: string, onClick: () => void) => (
    <button title={title} aria-label={title} disabled={busyId === id} onClick={onClick}
      className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40 flex-shrink-0" style={{ color: "#e0365a" }}>
      <Trash2 size={16} strokeWidth={1.5} />
    </button>
  );
  const row = (key: string, title: string, detail: string, actions: React.ReactNode) => (
    <div key={key} className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl" style={rowStyle}>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium truncate" style={{ color: c.mainFg }}>{title}</p>
        <p className="text-[11px] font-mono truncate" style={{ color: c.mainSub }}>{detail}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>
    </div>
  );

  const shown = tab === "system" ? 0 : rows[tab].length;
  const total = tab === "system" ? 0 : totals[tab] ?? 0;

  const statusDot = (ok: boolean) => <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: ok ? "#34d399" : "#e0365a" }} />;
  const systemCard = (icon: React.ElementType, title: string, ok: boolean, lines: [string, string][]) => {
    const Icon = icon;
    return (
      <div key={title} className="rounded-xl p-4 space-y-2" style={rowStyle}>
        <div className="flex items-center gap-2">
          <Icon size={15} strokeWidth={1.5} style={{ color: c.mainSub }} />
          <p className="text-[13px] font-semibold" style={{ color: c.mainFg }}>{title}</p>
        </div>
        {lines.map(([label, value], index) => (
          <div key={label} className="flex items-start justify-between gap-3 text-[12px]">
            <span style={{ color: c.mainSub }}>{label}</span>
            <span className="text-right break-all font-mono" style={{ color: c.mainFg }}>{index === 0 ? statusDot(ok) : null}{value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden" style={{ background: c.main, fontFamily: "'Inter', sans-serif" }}>
      <Sidebar c={c} open={sidebarOpen} onClose={() => setSidebarOpen(false)} user={user} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col min-w-0">
        <Header c={c} sidebarOpen={sidebarOpen} onOpenSidebar={() => setSidebarOpen(true)} user={user} />

        <div role="main" className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 py-8">
          <div className="max-w-[980px] mx-auto space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <ShieldCheck size={20} strokeWidth={1.5} style={{ color: "#7c5af0" }} />
                  <h1 className="text-[22px] font-semibold" style={{ color: c.mainFg, ...JK }}>{t("admin.title")}</h1>
                </div>
                <p className="text-[13px] mt-1" style={{ color: c.mainSub }}>{t("admin.subtitle")}</p>
              </div>
              <div className="flex items-center gap-3">
                {stats && <span className="text-[11px] font-mono" style={{ color: c.mainSub }}>{t("admin.updated", { time: new Date(stats.generatedAt).toLocaleTimeString(locale) })}</span>}
                <button onClick={() => void refreshAll()} disabled={refreshing}
                  className="px-3 py-1.5 rounded-full text-[12px] font-medium flex items-center gap-2 transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}`, color: c.mainFg }}>
                  <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> {t("admin.refresh")}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {statCards.map(s => (
                <div key={s.label} className="rounded-xl p-4" style={rowStyle}>
                  <s.icon size={15} strokeWidth={1.5} style={{ color: c.mainSub }} />
                  <p className="text-[20px] font-semibold mt-2 tabular-nums" style={{ color: c.mainFg, ...JK }}>{s.value}</p>
                  <p className="text-[11px] font-mono" style={{ color: c.mainSub }}>{s.label}</p>
                  {s.hint && <p className="text-[10px] font-mono mt-0.5" style={{ color: "#7c5af0" }}>{s.hint}</p>}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1 border-b overflow-x-auto" style={{ borderColor: c.chipBorder }} role="tablist">
              {tabs.map(item => (
                <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
                  className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap"
                  style={{ color: tab === item.id ? c.mainFg : c.mainSub, borderBottom: tab === item.id ? "2px solid #7c5af0" : "2px solid transparent" }}>
                  <item.icon size={14} strokeWidth={1.5} />
                  {t(`admin.tabs.${item.id}`)}
                </button>
              ))}
            </div>

            {tab !== "system" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 flex-1 min-w-56 rounded-xl px-3 py-2" style={{ background: c.inputBg }}>
                  <Search size={14} style={{ color: c.mainSub }} />
                  <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("admin.search")} aria-label={t("admin.search")}
                    className="flex-1 min-w-0 bg-transparent text-[13px] focus:outline-none" style={{ color: c.mainFg }} />
                </label>
                {!loading && <span className="text-[11px] font-mono" style={{ color: c.mainSub }}>{t("admin.showing", { shown, total })}</span>}
              </div>
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {loading ? (
              <p className="text-sm" style={{ color: c.mainSub }}>{t("loading")}</p>
            ) : tab === "system" ? (
              system && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {systemCard(Database, t("admin.system.database"), system.database.status === "ok", [
                    [t("admin.system.database"), system.database.status === "ok" ? t("admin.system.ok") : `${t("admin.system.error")} (${system.database.error})`],
                    [t("admin.system.latencyLabel"), system.database.latencyMs != null ? t("admin.system.latency", { ms: system.database.latencyMs }) : "—"],
                  ])}
                  {systemCard(Boxes, t("admin.system.vectorStore"), system.vectorStore.status !== "error", [
                    [system.vectorStore.provider, system.vectorStore.status === "error" ? `${t("admin.system.error")} (${system.vectorStore.error})` : t("admin.system.ok")],
                    ...(system.vectorStore.vectors != null ? [[t("admin.system.stored"), t("admin.system.vectors", { count: system.vectorStore.vectors })] as [string, string]] : []),
                    ...(system.vectorStore.latencyMs != null ? [[t("admin.system.latencyLabel"), t("admin.system.latency", { ms: system.vectorStore.latencyMs })] as [string, string]] : []),
                  ])}
                  {systemCard(Bot, t("admin.system.ai"), system.ai.configured, [
                    ["Groq", system.ai.configured ? t("admin.system.configured") : t("admin.system.notConfigured")],
                    [t("admin.system.model"), system.ai.model],
                    [t("admin.system.fallbacks"), system.ai.fallbacks.join(", ") || t("admin.system.none")],
                  ])}
                  {systemCard(Mail, t("admin.system.email"), system.email.configured && !system.email.lastError, [
                    ["SMTP", system.email.configured ? t("admin.system.configured") : t("admin.system.notConfigured")],
                    [t("admin.system.sent"), String(system.email.sent)],
                    [t("admin.system.failed"), String(system.email.failed)],
                    [t("admin.system.lastError"), system.email.lastError ? `${system.email.lastError} · ${new Date(system.email.lastErrorAt ?? "").toLocaleString(locale)}` : t("admin.system.none")],
                  ])}
                  {systemCard(KeyRound, t("admin.system.otp"), true, [
                    [t("admin.system.expiry"), t("admin.system.minutes", { count: Math.round(system.otp.expiresIn / 60) })],
                    [t("admin.system.cooldown"), t("admin.system.seconds", { count: system.otp.resendCooldown })],
                    [t("admin.system.attempts"), String(system.otp.maxAttempts)],
                    [t("admin.system.adminEmails"), String(system.adminEmails)],
                  ])}
                  {systemCard(Upload, t("admin.system.uploads"), true, [
                    [t("admin.system.maxFile"), `${system.uploads.maxFileSizeMb} MB`],
                    [t("admin.system.maxAttachments"), String(system.uploads.maxAttachments)],
                    [t("admin.system.concurrency"), String(system.uploads.uploadConcurrency)],
                    [t("admin.system.environment"), system.environment],
                  ])}
                </div>
              )
            ) : shown === 0 ? (
              <p className="text-sm" style={{ color: c.mainSub }}>{t("admin.empty")}</p>
            ) : (
              <div className="space-y-2">
                {tab === "users" && rows.users.map(u => row(u.id,
                  `${u.name}${u.role === "admin" ? ` · ${t("admin.adminBadge")}` : ""}${u.isConfiguredAdmin ? ` (${t("admin.configuredAdmin")})` : ""}`,
                  `${u.email} · ${t("admin.joined", { date: date(u.createdAt) })} · ${t("admin.userCounts", { documents: u.documents, quizzes: u.quizzes, flashcards: u.flashcardSets, conversations: u.conversations })}`,
                  u.id === user?.id ? null : (
                    <>
                      <button title={u.role === "admin" ? t("admin.removeAdmin") : t("admin.makeAdmin")} aria-label={u.role === "admin" ? t("admin.removeAdmin") : t("admin.makeAdmin")}
                        disabled={busyId === u.id || (u.role === "admin" && u.isConfiguredAdmin)} onClick={() => toggleRole(u)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40" style={{ color: u.role === "admin" ? "#7c5af0" : c.mainSub }}>
                        {u.role === "admin" ? <ShieldOff size={16} strokeWidth={1.5} /> : <Shield size={16} strokeWidth={1.5} />}
                      </button>
                      {deleteButton(t("admin.deleteUser"), u.id, () => deleteUser(u))}
                    </>
                  )))}

                {tab === "documents" && rows.documents.map(d => row(d.id, d.originalName,
                  `${t("dashboard.status." + d.status, { defaultValue: d.status })} · ${formatSize(d.size)} · ${date(d.createdAt)} · ${owner(d.owner)}`,
                  deleteButton(t("admin.delete"), d.id, () => deleteItem("documents", d.id, d.originalName, api.adminDeleteDocument))))}

                {tab === "quizzes" && rows.quizzes.map(q => row(q.id, q.title,
                  `${t("admin.questions", { count: q.questionCount })} · ${date(q.createdAt)} · ${owner(q.owner)}`,
                  deleteButton(t("admin.delete"), q.id, () => deleteItem("quizzes", q.id, q.title, api.adminDeleteQuiz))))}

                {tab === "flashcards" && rows.flashcards.map(s => row(s.id, s.title,
                  `${t("admin.cards", { count: s.cardCount })} · ${date(s.createdAt)} · ${owner(s.owner)}`,
                  deleteButton(t("admin.delete"), s.id, () => deleteItem("flashcards", s.id, s.title, api.adminDeleteFlashcardSet))))}

                {tab === "conversations" && rows.conversations.map(conversation => row(conversation.id, conversation.title,
                  `${t("admin.messages", { count: conversation.messageCount })} · ${t("admin.updatedAt", { date: date(conversation.updatedAt) })} · ${owner(conversation.owner)}`,
                  deleteButton(t("admin.delete"), conversation.id, () => deleteItem("conversations", conversation.id, conversation.title, api.adminDeleteConversation))))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
