export type Theme = "dark" | "light";

export function getThemeColors(theme: Theme) {
  const isDark = theme === "dark";
  return {
    isDark,
    sidebar: isDark ? "#08101e" : "#f7f7f8",
    sbBorder: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)",
    sbText: isDark ? "#8a9ab8" : "#9ca3af",
    sbHover: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.055)",
    sbFg: isDark ? "#c8d4e8" : "#111827",
    main: isDark ? "#080d1a" : "#ffffff",
    mainFg: isDark ? "#e2e6f0" : "#0d0d0d",
    mainSub: isDark ? "#6b7a99" : "#9ca3af",
    inputBg: isDark ? "#111827" : "#f4f4f4",
    inputBorder: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.1)",
    userBubble: isDark ? "#1a1240" : "#f3f4f6",
    userBorder: isDark ? "rgba(124,90,240,0.22)" : "rgba(0,0,0,0.08)",
    chipBg: isDark ? "#111827" : "#f3f4f6",
    chipBorder: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)",
    hdrBorder: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)",
    ctaBg: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
    ctaBorder: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)",
    loginBtn: isDark ? "#ffffff" : "#0d0d0d",
    loginBtnText: isDark ? "#080d1a" : "#ffffff",
  };
}

export type ThemeColors = ReturnType<typeof getThemeColors>;

export const JK = { fontFamily: "'Plus Jakarta Sans', sans-serif" };
