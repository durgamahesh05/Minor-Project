import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type User } from "../lib/api";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<string | undefined>;
  verifyRegistration: (email: string, otp: string) => Promise<User>;
  resendRegistrationOtp: (email: string) => Promise<string | undefined>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const PROFILE_KEY = "synapse-session-profile-v1";
function cachedUser(): User | null {
  try {
    const cached = JSON.parse(sessionStorage.getItem(PROFILE_KEY) || "null");
    return cached && Date.now() - cached.time < 300000 && typeof cached.user?.id === "string" ? cached.user : null;
  } catch { return null; }
}
function cacheUser(user: User | null) {
  try {
    if (user) sessionStorage.setItem(PROFILE_KEY, JSON.stringify({ user, time: Date.now() }));
    else sessionStorage.removeItem(PROFILE_KEY);
  } catch { /* Storage may be disabled. Authentication still works. */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(cachedUser);
  const [loading, setLoading] = useState(!user);
  const revision = useRef(0);

  useEffect(() => {
    const current = revision.current;
    let active = true;
    api
      .me()
      .then(({ user }) => { if (active && current === revision.current) { setUser(user); cacheUser(user); } })
      .catch(() => { if (active && current === revision.current) { setUser(null); cacheUser(null); } })
      .finally(() => { if (active && current === revision.current) setLoading(false); });
    return () => { active = false; };
  }, []);

  const login = async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    revision.current++;
    setUser(user);
    cacheUser(user);
    setLoading(false);
    return user;
  };

  // Registration is two steps: this stashes the signup and triggers an OTP —
  // no account exists and no session starts yet. verifyRegistration()
  // finishes the job once the code is confirmed.
  const register = async (name: string, email: string, password: string) => {
    const result = await api.register(name, email, password);
    return result.otp;
  };

  const verifyRegistration = async (email: string, otp: string) => {
    const { user } = await api.verifyRegistration(email, otp);
    revision.current++;
    setUser(user);
    cacheUser(user);
    setLoading(false);
    return user;
  };

  const resendRegistrationOtp = async (email: string) => {
    const result = await api.resendRegistrationOtp(email);
    return result.otp;
  };

  const logout = async () => {
    revision.current++;
    try {
      await api.logout();
    } finally {
      // Clear the local authenticated state even if a stale server session has
      // already expired, so the user is never left trapped in the app.
      setUser(null);
      cacheUser(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, verifyRegistration, resendRegistrationOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
