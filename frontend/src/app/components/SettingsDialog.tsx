import { useState } from "react";
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

type DeleteStep = "idle" | "confirm" | "otp" | "deleting" | "done";

export default function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { mode, setMode } = useTheme();
  const { language, setLanguage } = useLanguage();
  const [deleteStep, setDeleteStep] = useState<DeleteStep>("idle");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleRequestDelete = async () => {
    setError(null);
    try {
      const { otp } = await api.requestAccountDeletion();
      setDevOtp(otp ?? null);
      setDeleteStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
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
      setError(err instanceof ApiError ? err.message : "Something went wrong");
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
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>General</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div className="flex items-center gap-3">
              {mode === "dark" ? <Moon size={16} /> : mode === "light" ? <Sun size={16} /> : <Laptop size={16} />}
              <div>
                <p className="text-sm font-medium">Appearance</p>
                <p className="text-xs text-muted-foreground capitalize">{mode}</p>
              </div>
            </div>
            <Select value={mode} onValueChange={v => setMode(v as ThemeMode)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div className="flex items-center gap-3">
              <Languages size={16} />
              <div>
                <p className="text-sm font-medium">Language</p>
                <p className="text-xs text-muted-foreground">{languages.find(l => l.value === language)?.label}</p>
              </div>
            </div>
            <Select value={language} onValueChange={value => setLanguage(value as typeof language)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map(l => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-2 rounded-lg border border-destructive/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert size={16} />
            <p className="text-sm font-semibold">Danger zone</p>
          </div>

          {deleteStep === "idle" && (
            <>
              <p className="text-xs text-muted-foreground">
                Permanently delete your account and everything in it — chats, documents, quizzes, and flashcards. This
                email can't be used to sign up again for 30 days.
              </p>
              <Button variant="destructive" size="sm" onClick={() => setDeleteStep("confirm")}>
                Delete account
              </Button>
            </>
          )}

          {deleteStep === "confirm" && (
            <>
              <p className="text-xs text-muted-foreground">
                This can't be undone. We'll send a verification code to confirm it's really you.
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" onClick={handleRequestDelete}>
                  Yes, send me a code
                </Button>
                <Button variant="outline" size="sm" onClick={resetDeleteFlow}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {(deleteStep === "otp" || deleteStep === "deleting") && (
            <>
              {devOtp && (
                <p className="text-xs text-muted-foreground rounded-md border p-2">
                  No email service is configured yet (dev mode) — your verification code is{" "}
                  <span className="font-mono font-semibold text-foreground">{devOtp}</span>.
                </p>
              )}
              <Input
                placeholder="6-digit code"
                value={otpInput}
                onChange={e => setOtpInput(e.target.value)}
                maxLength={6}
                disabled={deleteStep === "deleting"}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirmDelete}
                  disabled={otpInput.length !== 6 || deleteStep === "deleting"}
                >
                  {deleteStep === "deleting" ? "Deleting…" : "Confirm deletion"}
                </Button>
                <Button variant="outline" size="sm" onClick={resetDeleteFlow} disabled={deleteStep === "deleting"}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
