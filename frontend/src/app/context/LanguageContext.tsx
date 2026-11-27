import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_STORAGE_KEY, initialLanguageSetting, resolveLanguage, type LanguageSetting } from "../i18n";

type Language = LanguageSetting;
type LanguageValue = {
  /** The user's choice, including "auto". Sent to the AI: "auto" answers in the language the user writes in. */
  language: Language;
  /** The language the UI is shown in. */
  resolvedLanguage: string;
  setLanguage: (language: Language) => void;
};
const LanguageContext = createContext<LanguageValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [language, setLanguageState] = useState<Language>(initialLanguageSetting);
  const setLanguage = (next: Language) => {
    setLanguageState(next);
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* private mode: keep it for this session */ }
    void i18n.changeLanguage(resolveLanguage(next));
  };
  return <LanguageContext.Provider value={{ language, resolvedLanguage: resolveLanguage(language), setLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used within LanguageProvider");
  return value;
}
