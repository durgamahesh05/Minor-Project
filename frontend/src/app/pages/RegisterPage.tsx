import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Brain } from "lucide-react";
import { useAuth, ApiError } from "../context/AuthContext";
import { isValidPassword, PASSWORD_REQUIREMENTS_MESSAGE } from "../lib/validatePassword";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PasswordInput } from "../components/PasswordInput";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

type Step = "form" | "otp";

export default function RegisterPage() {
  const { register, verifyRegistration, resendRegistrationOtp } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidPassword(password)) {
      setError(PASSWORD_REQUIREMENTS_MESSAGE);
      return;
    }
    setSubmitting(true);
    try {
      const developmentOtp = await register(name, email, password);
      setDevOtp(developmentOtp ?? null);
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyRegistration(email, otp);
      navigate("/chat");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setResending(true);
    try {
      const developmentOtp = await resendRegistrationOtp(email);
      setDevOtp(developmentOtp ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setResending(false);
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
          {step === "form" ? (
            <>
              <CardTitle>Sign up for free</CardTitle>
              <CardDescription>Create an account to save your chats.</CardDescription>
            </>
          ) : (
            <>
              <CardTitle>Verify your email</CardTitle>
              <CardDescription>Enter the code we sent to {email}.</CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          {step === "form" ? (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" required value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
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
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Sending code…" : "Sign up"}
                </Button>
              </form>
              <p className="text-sm text-muted-foreground mt-4 text-center">
                Already have an account?{" "}
                <Link to="/login" className="underline text-foreground">
                  Log in
                </Link>
              </p>
            </>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              {devOtp && (
                <p className="text-xs text-muted-foreground rounded-md border p-2">
                  No email service is configured yet (dev mode) — your verification code is{" "}
                  <span className="font-mono font-semibold text-foreground">{devOtp}</span>.
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="otp">Verification code</Label>
                <Input
                  id="otp"
                  required
                  maxLength={6}
                  autoFocus
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  placeholder="6-digit code"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting || otp.length !== 6}>
                {submitting ? "Verifying…" : "Verify and create account"}
              </Button>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <button type="button" onClick={() => setStep("form")} className="underline text-foreground">
                  Back
                </button>
                <button type="button" onClick={handleResend} disabled={resending} className="underline text-foreground disabled:opacity-50">
                  {resending ? "Sending…" : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
