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
} from "lucide-react";
import type { ThemeColors } from "../../lib/theme";
import { JK } from "../../lib/theme";
import { useTheme } from "../../context/ThemeContext";
import { useTranslation } from "react-i18next";
import type { User } from "../../lib/api";
import SettingsDialog from "../SettingsDialog";
import HelpDialog from "../HelpDialog";

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
      className="flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden"
      style={{ width: open ? 260 : 0, background: c.sidebar, borderRight: open ? `1px solid ${c.sbBorder}` : "none" }}
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

      <div className="px-3 space-y-0.5">
        {PRIMARY_NAV.map(item => (
          <NavItem key={item.to} c={c} icon={item.icon} label={item.to === "/chat" ? t("chat") : item.label} to={item.to} active={location.pathname === item.to} />
        ))}
        {user?.role === "admin" && (
          <NavItem c={c} icon={ShieldCheck} label="Admin" to="/admin" active={location.pathname === "/admin"} />
        )}
      </div>

      {children && (
        <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-0.5" style={{ borderTop: `1px solid ${c.sbBorder}`, marginTop: 8 }}>
          {children}
        </nav>
      )}
      {!children && <div className="flex-1" />}

      <div className="px-3 py-3 flex-shrink-0 space-y-0.5" style={{ borderTop: `1px solid ${c.sbBorder}` }}>
        <NavItem c={c} icon={theme === "dark" ? Sun : Moon} label={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggleTheme} />
        {user?.role !== "admin" && <NavItem c={c} icon={CreditCard} label="See plans and pricing" to="/pricing" />}
        <NavItem c={c} icon={Settings} label={t("settings")} onClick={() => setSettingsOpen(true)} />
        <NavItem c={c} icon={HelpCircle} label={t("help")} onClick={() => setHelpOpen(true)} />

        {user ? (
          <div className="mt-2 rounded-2xl p-4" style={{ background: c.ctaBg, border: `1px solid ${c.ctaBorder}` }}>
            <p className="text-[13px] font-semibold mb-1 leading-snug truncate" style={{ color: c.sbFg, ...JK }}>
              {user.name}
            </p>
            <p className="text-[11px] leading-relaxed mb-3 font-mono truncate" style={{ color: c.sbText }}>
              {user.email}
            </p>
            <button
              onClick={onLogout}
              className="w-full py-2 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
              style={{ background: c.sbHover, color: c.sbFg }}
            >
              <LogOut size={14} strokeWidth={1.5} />
              {t("logout")}
            </button>
          </div>
        ) : (
          <div className="mt-2 rounded-2xl p-4" style={{ background: c.ctaBg, border: `1px solid ${c.ctaBorder}` }}>
            <p className="text-[13px] font-semibold mb-1 leading-snug" style={{ color: c.sbFg, ...JK }}>
              Get responses tailored to you
            </p>
            <p className="text-[11px] leading-relaxed mb-3 font-mono" style={{ color: c.sbText }}>
              Log in to get answers based on saved chats, upload files, and track your progress.
            </p>
          </div>
        )}
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </aside>
  );
}
