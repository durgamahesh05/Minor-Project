import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Brain } from "lucide-react";
import { useAuth, ApiError } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PasswordInput } from "../components/PasswordInput";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    // Load the destination while credentials are being checked.
    void import("./ChatPage").catch(() => {});
    try {
      const user = await login(email, password);
      navigate(user.role === "admin" ? "/admin" : "/chat");
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
          <CardTitle>Log in</CardTitle>
          <CardDescription>Welcome back. Log in to continue your chats.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link to="/forgot-password" className="text-xs underline text-muted-foreground">
                  Forgot password?
                </Link>
              </div>
              <PasswordInput id="password" required value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Logging in…" : "Log in"}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground mt-4 text-center">
            Don't have an account?{" "}
            <Link to="/register" className="underline text-foreground">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
