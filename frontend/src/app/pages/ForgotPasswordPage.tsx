import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Brain, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { isValidPassword, PASSWORD_REQUIREMENTS_MESSAGE } from "../lib/validatePassword";
import { clearLinkParams, formatTime, OTP_LENGTH, otpInputProps, readLinkParams, useOtpTimers } from "../lib/otp";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PasswordInput } from "../components/PasswordInput";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

type Step = "email" | "otp" | "password" | "success";
const LINK_KEYS = ["email", "code"];

export default function ForgotPasswordPage() {
  // The "Reset Password" email link lands here with the email and code filled in.
  const [link] = useState(() => readLinkParams(LINK_KEYS));
  const fromLink = Boolean(link.email && link.code);
  const [step, setStep] = useState<Step>(fromLink ? "otp" : "email");
  const [email, setEmail] = useState(link.email ?? "");
  const [otp, setOtp] = useState(link.code?.replace(/\D/g, "").slice(0, OTP_LENGTH) ?? "");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timers = useOtpTimers();
  const verifying = useRef(false);
  const lastTried = useRef("");

  const requestOtp = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setSubmitting(true);
    try {
      const result = await api.forgotPassword(email);
      timers.start(result); setDevOtp(result.otp ?? null); setOtp(""); lastTried.current = ""; setStep("otp");
    } catch (err) { setError(err instanceof ApiError ? err.message : "Something went wrong"); }
    finally { setSubmitting(false); }
  };

  const verify = async (code: string) => {
    if (verifying.current || code.length !== OTP_LENGTH) return;
    verifying.current = true; lastTried.current = code;
    setError(null); setSubmitting(true);
    try { const result = await api.verifyPasswordOtp(email, code); setToken(result.token); setStep("password"); setDevOtp(null); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Something went wrong"); }
    finally { verifying.current = false; setSubmitting(false); }
  };

  const verifyOtp = (event: FormEvent) => { event.preventDefault(); void verify(otp); };

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

  const resendOtp = async () => {
    setError(null); setSubmitting(true);
    try {
      const result = await api.resendPasswordOtp(email);
      timers.start(result); setDevOtp(result.otp ?? null); setOtp(""); lastTried.current = "";
    } catch (err) { setError(err instanceof ApiError ? err.message : "Something went wrong"); }
    finally { setSubmitting(false); }
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    if (!isValidPassword(password)) { setError(PASSWORD_REQUIREMENTS_MESSAGE); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    setSubmitting(true);
    try { await api.resetPassword(token, password, confirmPassword); setToken(""); setStep("success"); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Something went wrong"); }
    finally { setSubmitting(false); }
  };

  const expired = !fromLink && timers.expiresIn === 0;
  const titles = {
    email: ["Reset your password", "Enter your account email and we'll send a verification code."],
    otp: ["Verify your email", fromLink && submitting ? `Verifying ${email}…` : `Enter the 6-digit code sent to ${email}, or open the link in the email.`],
    password: ["Set a new password", "Choose a new password for your account."],
    success: ["Password Reset Successful", "Your password has been updated successfully."],
  } as const;

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2.5 mb-2"><div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#7c5af0" }}><Brain size={14} strokeWidth={2} className="text-white" /></div><span className="font-semibold">Synapse</span></div>
          <CardTitle>{titles[step][0]}</CardTitle><CardDescription>{titles[step][1]}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "email" && <form onSubmit={requestOtp} className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Sending…" : "Send OTP"}</Button>
            <Link to="/login" className="text-sm underline text-foreground block text-center">Back to log in</Link>
          </form>}
          {step === "otp" && <form onSubmit={verifyOtp} className="space-y-4">
            {devOtp && <p className="text-xs text-muted-foreground rounded-md border p-2">Development verification code: <span className="font-mono font-semibold text-foreground">{devOtp}</span></p>}
            <div className="space-y-1.5"><Label htmlFor="otp">Verification code</Label><Input id="otp" required autoFocus placeholder="6-digit code" {...otpInputProps(otp, setOtp)} /></div>
            {!fromLink && <p className="text-xs text-muted-foreground" aria-live="polite">{timers.expiresIn > 0 ? `Code expires in ${formatTime(timers.expiresIn)}` : "Code expired. Request a new OTP."}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting || otp.length !== OTP_LENGTH || expired}>{submitting ? "Verifying…" : "Verify OTP"}</Button>
            <div className="flex items-center justify-between text-sm"><button type="button" className="underline text-foreground" onClick={() => { setStep("email"); setError(null); }}>Back</button><button type="button" className="underline text-foreground disabled:opacity-50" disabled={submitting || timers.resendIn > 0} onClick={resendOtp}>{timers.resendIn > 0 ? `Resend in ${timers.resendIn}s` : "Resend OTP"}</button></div>
          </form>}
          {step === "password" && <form onSubmit={updatePassword} className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="password">New password</Label><PasswordInput id="password" required minLength={7} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="confirmPassword">Confirm password</Label><PasswordInput id="confirmPassword" required minLength={7} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></div>
            <p className="text-xs text-muted-foreground">7+ characters, with uppercase, lowercase, a number, and a symbol.</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Updating…" : "Reset Password"}</Button>
          </form>}
          {step === "success" && <div className="space-y-4 text-center"><CheckCircle2 className="mx-auto text-green-600" size={36} /><Link to="/login"><Button className="w-full">Return to Login</Button></Link></div>}
        </CardContent>
      </Card>
    </div>
  );
}
