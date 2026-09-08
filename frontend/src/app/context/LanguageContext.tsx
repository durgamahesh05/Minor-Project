import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_STORAGE_KEY, languages } from "../i18n";

type Language = (typeof languages)[number]["value"];
const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void } | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [language, setLanguageState] = useState<Language>(() => (localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language) || "auto");
  const setLanguage = (next: Language) => {
    setLanguageState(next); localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    void i18n.changeLanguage(next === "auto" ? navigator.language.split("-")[0] : next);
  };
  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used within LanguageProvider");
  return value;
}
