import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Brain } from "lucide-react";
import { useAuth, ApiError } from "../context/AuthContext";
import { isValidPassword, PASSWORD_REQUIREMENTS_MESSAGE } from "../lib/validatePassword";
import { clearLinkParams, formatTime, OTP_LENGTH, otpInputProps, readLinkParams, useOtpTimers } from "../lib/otp";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PasswordInput } from "../components/PasswordInput";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

type Step = "form" | "otp";
const LINK_KEYS = ["email", "code"];

export default function RegisterPage() {
  const { register, verifyRegistration, resendRegistrationOtp } = useAuth();
  const navigate = useNavigate();
  // Opening the "Verify My Email" link lands here with the email and code filled in.
  const [link] = useState(() => readLinkParams(LINK_KEYS));
  const fromLink = Boolean(link.email && link.code);

  const [step, setStep] = useState<Step>(fromLink ? "otp" : "form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(link.email ?? "");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState(link.code?.replace(/\D/g, "").slice(0, OTP_LENGTH) ?? "");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const timers = useOtpTimers();
  const verifying = useRef(false);
  const lastTried = useRef("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidPassword(password)) {
      setError(PASSWORD_REQUIREMENTS_MESSAGE);
      return;
    }
    setSubmitting(true);
    try {
      const result = await register(name, email, password);
      setDevOtp(result.otp ?? null);
      setNotice(result.message);
      timers.start(result);
      setOtp("");
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const verify = async (code: string) => {
    if (verifying.current || code.length !== OTP_LENGTH) return;
    verifying.current = true;
    lastTried.current = code;
    setError(null);
    setSubmitting(true);
    try {
      await verifyRegistration(email, code);
      navigate("/chat");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      verifying.current = false;
      setSubmitting(false);
    }
  };

  const handleVerify = (e: FormEvent) => {
    e.preventDefault();
    void verify(otp);
  };

  // Verify straight away when arriving from the email link.
  useEffect(() => {
    clearLinkParams(LINK_KEYS);
    if (fromLink) void verify(otp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Submit as soon as the last digit is typed or a code is pasted (once per code).
  useEffect(() => {
    if (step === "otp" && otp.length === OTP_LENGTH && otp !== lastTried.current) void verify(otp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step]);

  const handleResend = async () => {
    setError(null);
    setResending(true);
    try {
      const result = await resendRegistrationOtp(email);
      setDevOtp(result.otp ?? null);
      setNotice(result.message);
      timers.start(result);
      setOtp("");
      lastTried.current = "";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setResending(false);
    }
  };

  const expired = !fromLink && timers.expiresIn === 0 && step === "otp" && !submitting;

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
              <CardDescription>
                {fromLink && submitting ? `Verifying ${email}…` : `Enter the code we sent to ${email}, or open the link in the email.`}
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          {step === "form" ? (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" required autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <PasswordInput
                    id="password"
                    required
                    minLength={7}
                    autoComplete="new-password"
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
              {notice && !devOtp && <p className="text-xs text-muted-foreground">{notice}</p>}
              <div className="space-y-1.5">
                <Label htmlFor="otp">Verification code</Label>
                <Input id="otp" required autoFocus placeholder="6-digit code" {...otpInputProps(otp, setOtp)} />
              </div>
              {!fromLink && (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {timers.expiresIn > 0 ? `Code expires in ${formatTime(timers.expiresIn)}` : "Code expired. Request a new code."}
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting || otp.length !== OTP_LENGTH || expired}>
                {submitting ? "Verifying…" : "Verify and create account"}
              </Button>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <button type="button" onClick={() => { setStep("form"); setError(null); }} className="underline text-foreground">
                  Back
                </button>
                <button type="button" onClick={handleResend} disabled={resending || timers.resendIn > 0} className="underline text-foreground disabled:opacity-50">
                  {resending ? "Sending…" : timers.resendIn > 0 ? `Resend in ${timers.resendIn}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
