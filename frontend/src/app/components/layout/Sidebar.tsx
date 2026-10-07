import { useState, type ReactNode } from "react";
import { useLocation, Link } from "react-router";
import {
  Brain,
  Menu,
  MessageSquare,
  LayoutDashboard,
  ListChecks,
  Layers,
  Settings,
  HelpCircle,
  ExternalLink,
  CreditCard,
  Sun,
  Moon,
  LogOut,
  ShieldCheck,
  ChevronsUpDown,
} from "lucide-react";
import type { ThemeColors } from "../../lib/theme";
import { JK } from "../../lib/theme";
import { useTheme } from "../../context/ThemeContext";
import { useTranslation } from "react-i18next";
import type { User } from "../../lib/api";
import SettingsDialog from "../SettingsDialog";
import HelpDialog from "../HelpDialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "../ui/dropdown-menu";

export type NavItemProps = {
  c: ThemeColors;
  icon: React.ElementType;
  label: string;
  external?: boolean;
  active?: boolean;
  to?: string;
  onClick?: () => void;
};

export function NavItem({ c, icon: Icon, label, external, active, to, onClick }: NavItemProps) {
  const content = (
    <>
      <Icon size={15} strokeWidth={1.5} style={{ color: c.sbText }} />
      <span className="flex-1 leading-none truncate">{label}</span>
      {external && <ExternalLink size={11} strokeWidth={1.5} style={{ color: c.sbText, opacity: 0.6 }} />}
    </>
  );
  const className = "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] text-left transition-colors group";
  const style = { color: c.sbFg, background: active ? c.sbHover : "transparent" };
  const hoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = c.sbHover),
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = active ? c.sbHover : "transparent"),
  };

  if (to) {
    return (
      <Link to={to} className={className} style={style} {...hoverHandlers}>
        {content}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={className} style={style} {...hoverHandlers}>
      {content}
    </button>
  );
}

type Props = {
  c: ThemeColors;
  open: boolean;
  onClose: () => void;
  user: User | null;
  onLogout: () => void;
  children?: ReactNode;
};

const PRIMARY_NAV = [
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/quiz", label: "Quiz", icon: ListChecks },
  { to: "/flashcards", label: "Flashcards", icon: Layers },
];

export default function Sidebar({ c, open, onClose, user, onLogout, children }: Props) {
  const { t } = useTranslation();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <aside
      className="max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 flex min-h-0 flex-col flex-shrink-0 transition-all duration-200 overflow-hidden"
      aria-hidden={!open}
      style={{ width: open ? 260 : 0, maxWidth: "85vw", visibility: open ? "visible" : "hidden", background: c.sidebar, borderRight: open ? `1px solid ${c.sbBorder}` : "none" }}
    >
      <div className="flex items-center justify-between px-4 h-14 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#7c5af0" }}>
            <Brain size={14} strokeWidth={2} className="text-white" />
          </div>
          <span className="text-[14px] font-semibold whitespace-nowrap" style={{ color: c.sbFg, ...JK }}>
            Synapse
          </span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: c.sbText }} title="Close sidebar">
          <Menu size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="px-3 shrink-0 space-y-0.5">
        {PRIMARY_NAV.map(item => (
          <NavItem key={item.to} c={c} icon={item.icon} label={item.to === "/chat" ? t("chat") : item.label} to={item.to} active={location.pathname === item.to} />
        ))}
        {user?.role === "admin" && (
          <NavItem c={c} icon={ShieldCheck} label="Admin" to="/admin" active={location.pathname === "/admin"} />
        )}
      </div>

      {children && (
        <nav aria-label="Chat history" className="sidebar-scrollbar flex-1 min-h-0 px-3 py-2 overflow-y-auto overflow-x-hidden overscroll-contain space-y-0.5" style={{ borderTop: `1px solid ${c.sbBorder}`, marginTop: 8, scrollbarColor: `${c.sbText} transparent`, scrollbarWidth: "thin", scrollbarGutter: "stable" }}>
          {children}
        </nav>
      )}
      {!children && <div className="flex-1" />}

      <div className="px-3 py-3 flex-shrink-0 space-y-0.5" style={{ borderTop: `1px solid ${c.sbBorder}` }}>
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Open profile menu"
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-[var(--profile-hover)] data-[state=open]:bg-[var(--profile-hover)] focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ color: c.sbFg, "--profile-hover": c.sbHover } as React.CSSProperties}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#7c5af0] text-xs font-semibold text-white">
                  {user.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "U"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold" style={JK}>{user.name}</span>
                  <span className="block truncate text-[11px]" style={{ color: c.sbText }}>{user.email}</span>
                </span>
                <ChevronsUpDown size={15} className="shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={12}
              className="w-60 max-w-[calc(100vw-24px)] rounded-2xl p-2"
              style={{ background: c.sidebar, color: c.sbFg, borderColor: c.sbBorder }}
            >
              <div className="px-3 py-2">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs" style={{ color: c.sbText }}>{user.email}</p>
              </div>
              <DropdownMenuSeparator style={{ background: c.sbBorder }} />
              <DropdownMenuItem className="rounded-lg px-3 py-2.5" onSelect={toggleTheme}>
                {theme === "dark" ? <Sun /> : <Moon />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              {user.role !== "admin" && (
                <DropdownMenuItem asChild className="rounded-lg px-3 py-2.5">
                  <Link to="/pricing"><CreditCard /> See plans and pricing</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="rounded-lg px-3 py-2.5" onSelect={() => setSettingsOpen(true)}>
                <Settings /> {t("settings")}
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-lg px-3 py-2.5" onSelect={() => setHelpOpen(true)}>
                <HelpCircle /> {t("help")}
              </DropdownMenuItem>
              <DropdownMenuSeparator style={{ background: c.sbBorder }} />
              <DropdownMenuItem className="rounded-lg px-3 py-2.5" onSelect={onLogout}>
                <LogOut /> {t("logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div>
            <NavItem c={c} icon={theme === "dark" ? Sun : Moon} label={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggleTheme} />
            <NavItem c={c} icon={CreditCard} label="See plans and pricing" to="/pricing" />
            <NavItem c={c} icon={Settings} label={t("settings")} onClick={() => setSettingsOpen(true)} />
            <NavItem c={c} icon={HelpCircle} label={t("help")} onClick={() => setHelpOpen(true)} />
          <div className="mt-2 rounded-2xl p-4" style={{ background: c.ctaBg, border: `1px solid ${c.ctaBorder}` }}>
            <p className="text-[13px] font-semibold mb-1 leading-snug" style={{ color: c.sbFg, ...JK }}>
              Get responses tailored to you
            </p>
            <p className="text-[11px] leading-relaxed mb-3 font-mono" style={{ color: c.sbText }}>
              Log in to get answers based on saved chats, upload files, and track your progress.
            </p>
          </div>
          </div>
        )}
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </aside>
  );
}
