import { Link } from "react-router";
import { Menu, ChevronDown } from "lucide-react";
import type { ThemeColors } from "../../lib/theme";
import { JK } from "../../lib/theme";
import type { User } from "../../lib/api";

type Props = {
  c: ThemeColors;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  user: User | null;
};

export default function Header({ c, sidebarOpen, onOpenSidebar, user }: Props) {
  return (
    <header className="flex items-center justify-between px-5 h-14 flex-shrink-0" style={{ borderBottom: `1px solid ${c.hdrBorder}` }}>
      <div className="flex items-center gap-2">
        {!sidebarOpen && (
          <button onClick={onOpenSidebar} className="p-1.5 rounded-lg transition-colors hover:opacity-70 mr-1" style={{ color: c.mainSub }} title="Open sidebar">
            <Menu size={16} strokeWidth={1.5} />
          </button>
        )}
        <button className="flex items-center gap-1.5 text-[15px] font-semibold transition-opacity hover:opacity-80" style={{ color: c.mainFg, ...JK }}>
          Synapse
          <ChevronDown size={14} strokeWidth={2} style={{ color: c.mainSub }} />
        </button>
      </div>

      {!user && (
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="px-4 py-1.5 rounded-full text-[13px] font-semibold border transition-opacity hover:opacity-80"
            style={{ color: c.mainFg, borderColor: c.hdrBorder, background: "transparent" }}
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="px-4 py-1.5 rounded-full text-[13px] font-semibold transition-opacity hover:opacity-85"
            style={{ background: c.loginBtn, color: c.loginBtnText }}
          >
            Sign up for free
          </Link>
        </div>
      )}
    </header>
  );
}
