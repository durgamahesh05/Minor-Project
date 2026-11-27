import { useCallback, useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";

export const OTP_LENGTH = 6;

/**
 * Code-expiry and resend countdowns driven by the server's timers.
 * Deadlines are absolute, so the numbers stay right even when the browser
 * throttles timers in a background tab or the request took a while.
 */
export function useOtpTimers() {
  const [deadlines, setDeadlines] = useState({ expires: 0, resend: 0 });
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (Math.max(deadlines.expires, deadlines.resend) <= Date.now()) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadlines]);

  const start = useCallback((timers: { expiresIn?: number; resendCooldown?: number }) => {
    const current = Date.now();
    setNowMs(current);
    setDeadlines({
      expires: current + Math.max(0, timers.expiresIn ?? 0) * 1000,
      resend: current + Math.max(0, timers.resendCooldown ?? 0) * 1000,
    });
  }, []);

  return {
    start,
    expiresIn: Math.max(0, Math.ceil((deadlines.expires - nowMs) / 1000)),
    resendIn: Math.max(0, Math.ceil((deadlines.resend - nowMs) / 1000)),
  };
}

export const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Digits only; lets phones offer the code from the SMS/email and accepts pasted codes with spaces. */
export function otpInputProps(value: string, onChange: (value: string) => void): InputHTMLAttributes<HTMLInputElement> {
  return {
    value,
    inputMode: "numeric",
    autoComplete: "one-time-code",
    pattern: `[0-9]{${OTP_LENGTH}}`,
    maxLength: OTP_LENGTH,
    onChange: event => onChange(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH)),
    onPaste: event => {
      const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
      if (digits) { event.preventDefault(); onChange(digits); }
    },
  };
}

/** Reads values such as ?email=&code= from an email link (pure, safe to call repeatedly). */
export function readLinkParams(keys: string[]): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const values: Record<string, string> = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) values[key] = value;
  }
  return values;
}

/** Removes link values from the address bar once used, so codes do not linger in history. */
export function clearLinkParams(keys: string[]) {
  const params = new URLSearchParams(window.location.search);
  if (!keys.some(key => params.has(key))) return;
  keys.forEach(key => params.delete(key));
  const rest = params.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
}
