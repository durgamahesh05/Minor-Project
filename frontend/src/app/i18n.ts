import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const LANGUAGE_STORAGE_KEY = "synapse-language";
export const languages = [
  { value: "auto", label: "Auto-detect" }, { value: "en", label: "English" }, { value: "hi", label: "Hindi" },
  { value: "te", label: "Telugu" }, { value: "es", label: "Spanish" }, { value: "fr", label: "French" },
] as const;

const resources = {
  en: { translation: { chat: "Chat", newChat: "New chat", begin: "Where should we begin?", askAnything: "Ask anything", listening: "Listening…", send: "Send", voiceInput: "Voice input", stopRecording: "Stop recording", loading: "Loading…", disclaimer: "Synapse can make mistakes. Verify important information from your source materials.", logout: "Log out", settings: "Settings", help: "Help", whatCanYouDo: "What can you do?" } },
  hi: { translation: { chat: "चैट", newChat: "नई चैट", begin: "हम कहाँ से शुरू करें?", askAnything: "कुछ भी पूछें", listening: "सुन रहा हूँ…", send: "भेजें", voiceInput: "आवाज़ से लिखें", stopRecording: "रिकॉर्डिंग रोकें", loading: "लोड हो रहा है…", disclaimer: "Synapse से गलतियाँ हो सकती हैं। महत्वपूर्ण जानकारी अपने स्रोतों से जाँचें।", logout: "लॉग आउट", settings: "सेटिंग्स", help: "सहायता", whatCanYouDo: "आप क्या कर सकते हैं?" } },
  te: { translation: { chat: "చాట్", newChat: "కొత్త చాట్", begin: "మనం ఎక్కడ ప్రారంభిద్దాం?", askAnything: "ఏదైనా అడగండి", listening: "వింటోంది…", send: "పంపు", voiceInput: "వాయిస్ ఇన్‌పుట్", stopRecording: "రికార్డింగ్ ఆపు", loading: "లోడ్ అవుతోంది…", disclaimer: "Synapse తప్పులు చేయవచ్చు. ముఖ్యమైన సమాచారాన్ని మీ మూలాల నుంచి నిర్ధారించండి.", logout: "లాగ్ అవుట్", settings: "సెట్టింగ్‌లు", help: "సహాయం", whatCanYouDo: "మీరు ఏమి చేయగలరు?" } },
  es: { translation: { chat: "Chat", newChat: "Chat nuevo", begin: "¿Por dónde empezamos?", askAnything: "Pregunta lo que quieras", listening: "Escuchando…", send: "Enviar", voiceInput: "Entrada de voz", stopRecording: "Detener grabación", loading: "Cargando…", disclaimer: "Synapse puede cometer errores. Verifica la información importante en tus materiales.", logout: "Cerrar sesión", settings: "Configuración", help: "Ayuda", whatCanYouDo: "¿Qué puedes hacer?" } },
  fr: { translation: { chat: "Discussion", newChat: "Nouvelle discussion", begin: "Par où commencer ?", askAnything: "Posez votre question", listening: "Écoute en cours…", send: "Envoyer", voiceInput: "Saisie vocale", stopRecording: "Arrêter l’enregistrement", loading: "Chargement…", disclaimer: "Synapse peut faire des erreurs. Vérifiez les informations importantes dans vos sources.", logout: "Se déconnecter", settings: "Paramètres", help: "Aide", whatCanYouDo: "Que peux-tu faire ?" } },
};

const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "auto";
i18n.use(initReactI18next).init({ resources, lng: saved === "auto" ? navigator.language.split("-")[0] : saved, fallbackLng: "en", interpolation: { escapeValue: false } });
export default i18n;
