"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/SearchInput";
import { ThemeToggle } from "@/components/controls/ThemeToggle";
import { LanguageSwitcher } from "@/components/controls/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useData } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { roleHome } from "@/lib/nav";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const school = useData((s) => s.school);
  const login = useSession((s) => s.login);
  const sessionUser = useSession((s) => s.user);
  const hydrated = useSession((s) => s.hydrated);

  useEffect(() => {
    if (hydrated && sessionUser) router.replace(roleHome(sessionUser.role));
  }, [hydrated, sessionUser, router]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // ignore repeated clicks while a sign-in is in flight
    setError("");
    if (!email.trim() || !password) {
      setError(t("auth.invalidCredentials"));
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError || !data.user) {
      setLoading(false);
      setError(t("auth.invalidCredentials"));
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", data.user.id)
      .single();

    if (!profile) {
      setLoading(false);
      setError(t("auth.invalidCredentials"));
      return;
    }

    login({
      id: data.user.id,
      name: profile.full_name,
      username: data.user.email ?? "",
      email: data.user.email ?? "",
      role: profile.role,
      entityId: data.user.id,
    });
    // Keep `loading` true: the button stays disabled until the redirect below
    // unmounts this page, instead of re-enabling mid-flight and inviting a
    // second click.
    router.replace(roleHome(profile.role));
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas p-4">
      {/* Decorative gradient backdrop */}
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-gradient-primary blur-3xl opacity-30" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-gradient-danger blur-3xl opacity-30" />
      </div>

      {/* Top controls */}
      <div className="absolute end-4 top-4 z-10 flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-0 w-full max-w-md rounded-3xl border border-line bg-surface p-8 card-shadow-lg"
      >
        {/* Logo + school name */}
        <div className="flex flex-col items-center text-center">
          <div className="login-logo-frame card-shadow">
            <div className="h-20 w-20 rounded-[1.25rem] bg-surface flex items-center justify-center overflow-hidden">
              {school.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={school.logo}
                  alt={school.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-4xl bg-gradient-to-br from-red-500/10 to-red-500/20">
                  🏫
                </div>
              )}
            </div>
          </div>
          <h1 className="mt-4 text-2xl font-extrabold login-name-gradient">{school.name}</h1>
          <p className="mt-1 text-sm text-muted">{t("auth.signInSubtitle")}</p>
        </div>

        {/* Login */}
        <form onSubmit={handleManual} className="mt-7 space-y-3">
          <Input
            type="email"
            placeholder={t("auth.email")}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
          />
          <Input
            type="password"
            placeholder={t("auth.password")}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
          />
          {error && <p className="text-sm font-medium text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? "..." : t("auth.signIn")}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
