import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Brain } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { isValidPassword, PASSWORD_REQUIREMENTS_MESSAGE } from "../lib/validatePassword";
import { Button } from "../components/ui/button";
import { PasswordInput } from "../components/PasswordInput";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidPassword(password)) {
      setError(PASSWORD_REQUIREMENTS_MESSAGE);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(token, password, confirmPassword);
      setDone(true);
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#7c5af0" }}>
              <Brain size={14} strokeWidth={2} className="text-white" />
            </div>
            <span className="font-semibold">Synapse</span>
          </div>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>Choose a new password for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <p className="text-sm text-destructive">
              This link is missing its reset token.{" "}
              <Link to="/forgot-password" className="underline">
                Request a new one
              </Link>
              .
            </p>
          ) : done ? (
            <p className="text-sm text-muted-foreground">Password updated. Redirecting to log in…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <PasswordInput
                  id="password"
                  required
                  minLength={7}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  7+ characters, with uppercase, lowercase, a number, and a symbol.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <PasswordInput id="confirmPassword" required minLength={7} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
