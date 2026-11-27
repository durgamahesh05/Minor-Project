import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./locales";

export const LANGUAGE_STORAGE_KEY = "synapse-language";
// Language names are shown in their own script so people can always find theirs.
export const languages = [
  { value: "auto", label: "Auto-detect" }, { value: "en", label: "English" }, { value: "hi", label: "हिन्दी" },
  { value: "te", label: "తెలుగు" }, { value: "es", label: "Español" }, { value: "fr", label: "Français" },
] as const;

export type LanguageSetting = (typeof languages)[number]["value"];
const supported = new Set<string>(Object.keys(resources));

/** The UI language actually shown for a setting ("auto" follows the browser). */
export function resolveLanguage(setting: string | null | undefined): string {
  if (setting && setting !== "auto" && supported.has(setting)) return setting;
  const browser = (typeof navigator !== "undefined" ? navigator.languages?.[0] ?? navigator.language : "en") || "en";
  const code = browser.split("-")[0].toLowerCase();
  return supported.has(code) ? code : "en";
}

function readSetting(): LanguageSetting {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return (languages.some(language => language.value === saved) ? saved : "auto") as LanguageSetting;
  } catch {
    return "auto";
  }
}

export const initialLanguageSetting = readSetting();

i18n.on("languageChanged", language => {
  if (typeof document !== "undefined") document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage(initialLanguageSetting),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
