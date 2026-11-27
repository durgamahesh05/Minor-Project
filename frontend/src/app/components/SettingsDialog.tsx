import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Sun, Moon, Laptop, Languages, ShieldAlert } from "lucide-react";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import { api, ApiError } from "../lib/api";
import { languages } from "../i18n";
import { useLanguage } from "../context/LanguageContext";
import { clearAllLocalDocuments } from "../lib/documentStorage";
import { useTranslation } from "react-i18next";
import { formatTime, OTP_LENGTH, otpInputProps, useOtpTimers } from "../lib/otp";

type DeleteStep = "idle" | "confirm" | "otp" | "deleting" | "done";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Code from the "Confirm Account Deletion" email link; opens the confirmation step pre-filled. */
  initialDeleteCode?: string;
};

export default function SettingsDialog({ open, onOpenChange, initialDeleteCode }: Props) {
  const { mode, setMode } = useTheme();
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();
  const languageLabel = (value: string) => value === "auto" ? t("settingsDialog.autoDetect") : languages.find(l => l.value === value)?.label;
  const [deleteStep, setDeleteStep] = useState<DeleteStep>("idle");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const timers = useOtpTimers();

  useEffect(() => {
    if (open && initialDeleteCode) {
      setDeleteStep("otp");
      setOtpInput(initialDeleteCode.replace(/\D/g, "").slice(0, OTP_LENGTH));
    }
  }, [open, initialDeleteCode]);

  const handleRequestDelete = async () => {
    setError(null);
    setRequesting(true);
    try {
      const result = await api.requestAccountDeletion();
      setDevOtp(result.otp ?? null);
      timers.start(result);
      setOtpInput("");
      setDeleteStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWrong"));
    } finally {
      setRequesting(false);
    }
  };

  const handleConfirmDelete = async () => {
    setError(null);
    setDeleteStep("deleting");
    try {
      await api.confirmAccountDeletion(otpInput);
      await clearAllLocalDocuments();
      setDeleteStep("done");
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWrong"));
      setDeleteStep("otp");
    }
  };

  const resetDeleteFlow = () => {
    setDeleteStep("idle");
    setOtpInput("");
    setDevOtp(null);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={next => { onOpenChange(next); if (!next) resetDeleteFlow(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings")}</DialogTitle>
          <DialogDescription>{t("settingsDialog.general")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div className="flex items-center gap-3">
              {mode === "dark" ? <Moon size={16} /> : mode === "light" ? <Sun size={16} /> : <Laptop size={16} />}
              <div>
                <p className="text-sm font-medium">{t("settingsDialog.appearance")}</p>
                <p className="text-xs text-muted-foreground">{t("settingsDialog." + mode)}</p>
              </div>
            </div>
            <Select value={mode} onValueChange={v => setMode(v as ThemeMode)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settingsDialog.system")}</SelectItem>
                <SelectItem value="light">{t("settingsDialog.light")}</SelectItem>
                <SelectItem value="dark">{t("settingsDialog.dark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div className="flex items-center gap-3">
              <Languages size={16} />
              <div>
                <p className="text-sm font-medium">{t("settingsDialog.language")}</p>
                <p className="text-xs text-muted-foreground">{languageLabel(language)}</p>
              </div>
            </div>
            <Select value={language} onValueChange={value => setLanguage(value as typeof language)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map(l => (
                  <SelectItem key={l.value} value={l.value}>
                    {languageLabel(l.value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-2 rounded-lg border border-destructive/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert size={16} />
            <p className="text-sm font-semibold">{t("settingsDialog.dangerZone")}</p>
          </div>

          {deleteStep === "idle" && (
            <>
              <p className="text-xs text-muted-foreground">
                {t("settingsDialog.deleteWarning")}
              </p>
              <Button variant="destructive" size="sm" onClick={() => setDeleteStep("confirm")}>
                {t("settingsDialog.deleteAccount")}
              </Button>
            </>
          )}

          {deleteStep === "confirm" && (
            <>
              <p className="text-xs text-muted-foreground">
                {t("settingsDialog.confirmWarning")}
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" onClick={handleRequestDelete} disabled={requesting}>
                  {requesting ? t("settingsDialog.sending") : t("settingsDialog.sendCode")}
                </Button>
                <Button variant="outline" size="sm" onClick={resetDeleteFlow}>
                  {t("common.cancel")}
                </Button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </>
          )}

          {(deleteStep === "otp" || deleteStep === "deleting") && (
            <>
              {devOtp && (
                <p className="text-xs text-muted-foreground rounded-md border p-2">
                  {t("settingsDialog.devCode")}{" "}
                  <span className="font-mono font-semibold text-foreground">{devOtp}</span>.
                </p>
              )}
              <Input
                placeholder={t("settingsDialog.codePlaceholder")}
                aria-label={t("settingsDialog.codePlaceholder")}
                {...otpInputProps(otpInput, setOtpInput)}
                disabled={deleteStep === "deleting"}
              />
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground" aria-live="polite">
                <span>{timers.expiresIn > 0 ? t("settingsDialog.expiresIn", { time: formatTime(timers.expiresIn) }) : initialDeleteCode ? "" : t("settingsDialog.codeExpired")}</span>
                <button type="button" className="underline disabled:opacity-50" disabled={requesting || timers.resendIn > 0 || deleteStep === "deleting"} onClick={handleRequestDelete}>
                  {timers.resendIn > 0 ? t("settingsDialog.resendIn", { seconds: timers.resendIn }) : t("settingsDialog.resend")}
                </button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirmDelete}
                  disabled={otpInput.length !== OTP_LENGTH || deleteStep === "deleting"}
                >
                  {deleteStep === "deleting" ? t("settingsDialog.deleting") : t("settingsDialog.confirmDeletion")}
                </Button>
                <Button variant="outline" size="sm" onClick={resetDeleteFlow} disabled={deleteStep === "deleting"}>
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
