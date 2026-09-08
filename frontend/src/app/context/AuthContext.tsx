import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    setUser(user);
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
    setUser(user);
    return user;
  };

  const resendRegistrationOtp = async (email: string) => {
    const result = await api.resendRegistrationOtp(email);
    return result.otp;
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      // Clear the local authenticated state even if a stale server session has
      // already expired, so the user is never left trapped in the app.
      setUser(null);
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
