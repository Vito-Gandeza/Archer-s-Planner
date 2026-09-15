"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = supabaseBrowser();
    const { error } =
      mode === "signin"
        ? await sb.auth.signInWithPassword({ email, password })
        : await sb.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setMsg(error.message);
    if (mode === "signup") return setMsg("Check your inbox to confirm, then sign in.");
    window.location.href = "/";
  }

  return (
    <div className="shell narrow" style={{ maxWidth: 460 }}>
      <header className="masthead">
        <div className="rise">
          <h1>Archer&apos;s Planner</h1>
          <p className="dek">Canvas deadlines, schedule and grades, in one dashboard.</p>
        </div>
      </header>
      <hr className="rule" />

      <form onSubmit={submit} className="stack" style={{ marginTop: 28 }}>
        <label className="stack" style={{ gap: 6 }}>
          <span className="sectionhead" style={{ margin: 0 }}>
            DLSU email
          </span>
          <input
            className="field"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="sectionhead" style={{ margin: 0 }}>
            Password
          </span>
          <input
            className="field"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {msg && <p className="err">{msg}</p>}
        <div className="nav">
          <button className="btn" data-primary="true" type="submit" disabled={busy}>
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
          >
            {mode === "signin" ? "Sign up instead" : "I have an account"}
          </button>
        </div>
      </form>
    </div>
  );
}
