"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "adminPassword";

/** Flat token row — matches denormalized columns on `tokens` */
export type FlatTokenRow = {
  id: string;
  token_code: string | null;
  citizen_name: string | null;
  citizen_phone: string | null;
  citizen_driving_license?: string | null;
  station_name: string | null;
  slot_date: string | null;
  slot_start_time: string | null;
  slot_end_time: string | null;
  fuel_type: string | null;
  payment_method: string | null;
  payment_number: string | null;
  transaction_id: string | null;
  payment_submitted_at: string | null;
  amount: number | null;
  status: string;
  created_at?: string | null;
};

type CitizenAdmin = {
  id: string;
  full_name: string | null;
  phone: string | null;
  driving_license_number: string | null;
  locked_until: string | null;
  total_tokens: number;
};

type Stats = {
  pendingTotal: number;
  activeToday: number;
  usedToday: number;
  rejectedTotal: number;
};

type NavId = "dashboard" | "pending" | "tokens" | "citizens";
type TokenTab = "all" | "pending" | "active" | "used" | "rejected";

type ToastState = {
  type: "success" | "error";
  message: string;
} | null;

function formatAmount(amount: number | null | undefined): string {
  if (amount != null && !Number.isNaN(Number(amount))) return `৳${Number(amount)}`;
  return "৳20";
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} mins ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function slotTimeLine(row: FlatTokenRow): string {
  const a = row.slot_start_time?.slice(0, 5) ?? "—";
  const b = row.slot_end_time?.slice(0, 5) ?? "—";
  return `${a} – ${b}`;
}

function lockCountdown(lockedUntil: string | null): string | null {
  if (!lockedUntil) return null;
  const end = new Date(lockedUntil).getTime();
  if (end <= Date.now()) return null;
  const ms = end - Date.now();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days >= 1)
    return `Locked for ${days} more day${days === 1 ? "" : "s"}`;
  if (hours >= 1)
    return `Locked for ${hours} more hour${hours === 1 ? "" : "s"}`;
  return `Locked for ${mins} more min${mins === 1 ? "" : "s"}`;
}

function isLocked(lockedUntil: string | null): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}

function PaymentBadge({ method }: { method: string | null }) {
  const m = (method ?? "").toLowerCase();
  if (m === "bkash") {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-300">
        bKash
      </span>
    );
  }
  if (m === "nagad") {
    return (
      <span className="inline-flex rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-900 ring-1 ring-orange-300">
        Nagad
      </span>
    );
  }
  if (m === "rocket") {
    return (
      <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-900 ring-1 ring-blue-300">
        Rocket
      </span>
    );
  }
  return <span className="text-xs text-zinc-500">{method ?? "—"}</span>;
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold";
  if (s === "active")
    return (
      <span className={`${base} bg-emerald-100 text-emerald-900`}>Active</span>
    );
  if (s === "pending_approval" || s === "pending_payment") {
    return (
      <span className={`${base} bg-amber-100 text-amber-900`}>{status}</span>
    );
  }
  if (s === "used")
    return <span className={`${base} bg-zinc-200 text-zinc-800`}>Used</span>;
  if (s === "rejected")
    return <span className={`${base} bg-red-100 text-red-800`}>Rejected</span>;
  return <span className={`${base} bg-zinc-100 text-zinc-700`}>{status}</span>;
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div
      role="status"
      className={`fixed left-1/2 top-4 z-[200] w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-sm font-semibold shadow-xl ring-1 ${
        toast.type === "success"
          ? "bg-emerald-600 text-white ring-emerald-700"
          : "bg-red-600 text-white ring-red-700"
      }`}
    >
      {toast.message}
    </div>
  );
}

function NavIcon({
  name,
  active,
}: {
  name: "home" | "clock" | "list" | "users";
  active: boolean;
}) {
  const cls = `size-6 ${active ? "text-emerald-600" : "text-zinc-500"}`;
  switch (name) {
    case "home":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      );
    case "clock":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "list":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      );
    case "users":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      );
  }
}

export default function AdminPage() {
  const [authReady, setAuthReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [nav, setNav] = useState<NavId>("dashboard");
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState<FlatTokenRow[]>([]);
  const [allTokens, setAllTokens] = useState<FlatTokenRow[]>([]);
  const [citizens, setCitizens] = useState<CitizenAdmin[]>([]);

  const [tokenTab, setTokenTab] = useState<TokenTab>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [pendingLoading, setPendingLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [unlockBusyId, setUnlockBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());

  const [refreshSec, setRefreshSec] = useState(30);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const postJson = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    },
    [password],
  );

  const fetchStats = useCallback(async () => {
    const { res, data } = await postJson("/api/admin/stats", {});
    if (!res.ok) return;
    setStats({
      pendingTotal: data.pendingTotal ?? 0,
      activeToday: data.activeToday ?? 0,
      usedToday: data.usedToday ?? 0,
      rejectedTotal: data.rejectedTotal ?? 0,
    });
  }, [postJson]);

  const fetchPending = useCallback(async () => {
    if (!password.trim()) return;
    setPendingLoading(true);
    try {
      const { res, data } = await postJson("/api/admin/pending-tokens", {});
      if (!res.ok) {
        setLoadError(
          typeof data.error === "string" ? data.error : "Failed to load pending",
        );
        setPending([]);
        return;
      }
      setPending(Array.isArray(data.tokens) ? data.tokens : []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Network error");
      setPending([]);
    } finally {
      setPendingLoading(false);
    }
  }, [postJson, password]);

  const fetchAllTokens = useCallback(async () => {
    if (!password.trim()) return;
    const { res, data } = await postJson("/api/admin/all-tokens", {
      tab: tokenTab,
      search: debouncedSearch,
    });
    if (!res.ok) {
      setAllTokens([]);
      return;
    }
    setAllTokens(Array.isArray(data.tokens) ? data.tokens : []);
  }, [postJson, password, tokenTab, debouncedSearch]);

  const fetchCitizens = useCallback(async () => {
    if (!password.trim()) return;
    const { res, data } = await postJson("/api/admin/all-citizens", {});
    if (!res.ok) {
      setCitizens([]);
      return;
    }
    setCitizens(Array.isArray(data.citizens) ? data.citizens : []);
  }, [postJson, password]);

  const bootstrap = useCallback(async (pwd: string) => {
      const res = await fetch("/api/admin/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: pwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return false;
      setStats({
        pendingTotal: data.pendingTotal ?? 0,
        activeToday: data.activeToday ?? 0,
        usedToday: data.usedToday ?? 0,
        rejectedTotal: data.rejectedTotal ?? 0,
      });
      await Promise.all([
        (async () => {
          const r = await fetch("/api/admin/pending-tokens", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminPassword: pwd }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) setPending(Array.isArray(d.tokens) ? d.tokens : []);
        })(),
        (async () => {
          const r = await fetch("/api/admin/all-tokens", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              adminPassword: pwd,
              tab: "all",
              search: "",
            }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) setAllTokens(Array.isArray(d.tokens) ? d.tokens : []);
        })(),
        (async () => {
          const r = await fetch("/api/admin/all-citizens", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminPassword: pwd }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) setCitizens(Array.isArray(d.citizens) ? d.citizens : []);
        })(),
      ]);
      return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      if (!saved) {
        if (!cancelled) setAuthReady(true);
        return;
      }
      const ok = await bootstrap(saved);
      if (cancelled) return;
      if (ok) {
        setLoggedIn(true);
        setPassword(saved);
      } else {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
      setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  useEffect(() => {
    if (!loggedIn || !password) return;
    setRefreshSec(30);
    const id = window.setInterval(() => {
      setRefreshSec((s) => {
        if (s <= 1) {
          void fetchPending();
          return 30;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [loggedIn, password, fetchPending]);

  useEffect(() => {
    if (!loggedIn) return;
    void fetchAllTokens();
  }, [loggedIn, fetchAllTokens]);

  const handleLogin = async () => {
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await fetch("/api/admin/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setLoginError("Invalid password.");
        return;
      }
      if (!res.ok) {
        setLoginError(typeof data.error === "string" ? data.error : "Login failed.");
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY, password);
      } catch {
        /* ignore */
      }
      setStats({
        pendingTotal: data.pendingTotal ?? 0,
        activeToday: data.activeToday ?? 0,
        usedToday: data.usedToday ?? 0,
        rejectedTotal: data.rejectedTotal ?? 0,
      });
      setLoggedIn(true);
      await Promise.all([fetchPending(), fetchAllTokens(), fetchCitizens()]);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setLoggedIn(false);
    setPassword("");
    setStats(null);
    setPending([]);
    setAllTokens([]);
    setCitizens([]);
    setNav("dashboard");
  };

  const handleApprove = async (row: FlatTokenRow) => {
    setActionError(null);
    setActionBusyId(row.id);
    try {
      const { res, data } = await postJson("/api/admin/approve-token", {
        tokenId: row.id,
      });
      if (!res.ok) {
        setActionError(
          typeof data.error === "string" ? data.error : "Approve failed",
        );
        return;
      }
      setExitingIds((prev) => new Set(prev).add(row.id));
      setToast({
        type: "success",
        message: `Approved! SMS sent to ${row.citizen_phone ?? "user"}`,
      });
      window.setTimeout(() => {
        setExitingIds(new Set());
        void fetchPending();
        void fetchStats();
      }, 380);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRejectSubmit = async (tokenId: string) => {
    setActionError(null);
    setActionBusyId(tokenId);
    try {
      const { res, data } = await postJson("/api/admin/reject-token", {
        tokenId,
        reason: rejectReason.trim() || undefined,
      });
      if (!res.ok) {
        setActionError(
          typeof data.error === "string" ? data.error : "Reject failed",
        );
        return;
      }
      setRejectingId(null);
      setRejectReason("");
      setToast({ type: "error", message: "Rejected. Citizen notified." });
      setExitingIds((prev) => new Set(prev).add(tokenId));
      window.setTimeout(() => {
        setExitingIds(new Set());
        void fetchPending();
        void fetchStats();
      }, 380);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setActionBusyId(null);
    }
  };

  const handleUnlock = async (citizenId: string) => {
    setActionError(null);
    setUnlockBusyId(citizenId);
    try {
      const { res, data } = await postJson("/api/admin/unlock-citizen", {
        citizenId,
      });
      if (!res.ok) {
        setActionError(
          typeof data.error === "string" ? data.error : "Unlock failed",
        );
        return;
      }
      await fetchCitizens();
      await fetchStats();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setUnlockBusyId(null);
    }
  };

  const licenseCell = (row: FlatTokenRow) =>
    row.citizen_driving_license ?? "—";

  const navBtn = (id: NavId, label: string, icon: "home" | "clock" | "list" | "users") => (
    <button
      key={id}
      type="button"
      onClick={() => setNav(id)}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
        nav === id
          ? "bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200"
          : "text-zinc-700 hover:bg-zinc-100"
      }`}
    >
      <NavIcon name={icon} active={nav === id} />
      {label}
    </button>
  );

  const mobileNavBtn = (id: NavId, label: string, icon: "home" | "clock" | "list" | "users") => (
    <button
      key={id}
      type="button"
      onClick={() => setNav(id)}
      className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${
        nav === id ? "text-emerald-600" : "text-zinc-500"
      }`}
    >
      <NavIcon name={icon} active={nav === id} />
      <span className="truncate px-0.5">{label}</span>
    </button>
  );

  if (!authReady) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-100">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-zinc-100 to-zinc-200 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl">
          <h1 className="text-center text-2xl font-bold tracking-tight text-zinc-900">
            FuelToken Admin
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-500">
            Sign in to continue
          </p>
          <label className="mt-8 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setLoginError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && void handleLogin()}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20"
              autoComplete="current-password"
            />
          </label>
          {loginError && (
            <p className="mt-3 text-center text-sm font-medium text-red-600">
              {loginError}
            </p>
          )}
          <button
            type="button"
            disabled={loginLoading || !password.trim()}
            onClick={() => void handleLogin()}
            className="mt-6 flex w-full min-h-12 items-center justify-center rounded-xl bg-emerald-600 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {loginLoading ? "Signing in…" : "Login"}
          </button>
        </div>
      </div>
    );
  }

  const statsCards = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Total pending
        </p>
        <p className="mt-2 text-3xl font-bold text-amber-950">
          {stats?.pendingTotal ?? "—"}
        </p>
      </div>
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
          Active tokens today
        </p>
        <p className="mt-2 text-3xl font-bold text-emerald-950">
          {stats?.activeToday ?? "—"}
        </p>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
          Used today
        </p>
        <p className="mt-2 text-3xl font-bold text-zinc-900">
          {stats?.usedToday ?? "—"}
        </p>
      </div>
      <div className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-rose-50 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-red-800">
          Total rejected
        </p>
        <p className="mt-2 text-3xl font-bold text-red-950">
          {stats?.rejectedTotal ?? "—"}
        </p>
      </div>
    </div>
  );

  const pendingSection = (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold text-zinc-900">Pending approvals</h2>
          <span className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full bg-orange-500 px-4 text-lg font-black text-white shadow-md ring-4 ring-orange-200">
            {pending.length}
          </span>
        </div>
        <p className="text-sm font-medium text-zinc-600">
          {pendingLoading
            ? "Refreshing…"
            : `Refreshing in ${refreshSec}s…`}
        </p>
      </div>

      {actionError && (
        <p className="text-sm font-medium text-red-600">{actionError}</p>
      )}
      {loadError && (
        <p className="text-sm text-red-600">{loadError}</p>
      )}

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {pending.length === 0 && !pendingLoading && (
          <p className="rounded-2xl border border-zinc-200 bg-white py-12 text-center text-zinc-500">
            No pending approvals.
          </p>
        )}
        {pending.map((row) => (
          <div
            key={row.id}
            className={`overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-all duration-300 ${
              exitingIds.has(row.id) ? "scale-95 opacity-0" : "opacity-100"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-zinc-900">
                  {row.citizen_name ?? "—"}
                </p>
                <p className="font-mono text-sm text-zinc-600">
                  {row.citizen_phone ?? "—"}
                </p>
              </div>
              <span className="text-xs text-zinc-500">
                {formatRelative(row.payment_submitted_at)}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-zinc-500">License</dt>
                <dd className="font-mono text-zinc-800">{licenseCell(row)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Fuel</dt>
                <dd className="text-zinc-800">{row.fuel_type ?? "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-zinc-500">Station</dt>
                <dd className="text-zinc-800">{row.station_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Date</dt>
                <dd>{row.slot_date ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Time</dt>
                <dd className="font-mono">{slotTimeLine(row)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Method</dt>
                <dd>
                  <PaymentBadge method={row.payment_method} />
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Amount</dt>
                <dd className="font-semibold">{formatAmount(row.amount)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-zinc-500">Trx ID</dt>
                <dd className="font-mono text-sm font-bold break-all text-zinc-900">
                  {row.transaction_id ?? "—"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-zinc-500">Sent from</dt>
                <dd className="font-mono">{row.payment_number ?? "—"}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={actionBusyId === row.id}
                onClick={() => void handleApprove(row)}
                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={actionBusyId === row.id}
                onClick={() => {
                  setRejectingId(rejectingId === row.id ? null : row.id);
                  setRejectReason("");
                }}
                className="w-full rounded-xl border-2 border-red-200 bg-red-50 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                Reject
              </button>
              {rejectingId === row.id && (
                <div className="rounded-xl border border-red-200 bg-red-50/80 p-3">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm"
                    placeholder="Reason for rejection"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleRejectSubmit(row.id)}
                      disabled={actionBusyId === row.id}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectReason("");
                      }}
                      className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm md:block">
        <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              <th className="px-3 py-3">Submitted</th>
              <th className="px-3 py-3">Citizen</th>
              <th className="px-3 py-3">License</th>
              <th className="px-3 py-3">Fuel</th>
              <th className="px-3 py-3">Station</th>
              <th className="px-3 py-3">Slot</th>
              <th className="px-3 py-3">Method</th>
              <th className="px-3 py-3">Trx ID</th>
              <th className="px-3 py-3">From</th>
              <th className="px-3 py-3">Amt</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 && !pendingLoading && (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-zinc-500">
                  No pending approvals.
                </td>
              </tr>
            )}
            {pending.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className={`border-b border-zinc-100 align-top transition-all duration-300 ${
                    exitingIds.has(row.id) ? "opacity-0" : "opacity-100"
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-zinc-600">
                    {formatRelative(row.payment_submitted_at)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-zinc-900">
                      {row.citizen_name ?? "—"}
                    </div>
                    <div className="font-mono text-xs text-zinc-600">
                      {row.citizen_phone ?? "—"}
                    </div>
                  </td>
                  <td className="max-w-[100px] px-3 py-3 font-mono text-xs">
                    {licenseCell(row)}
                  </td>
                  <td className="px-3 py-3">{row.fuel_type ?? "—"}</td>
                  <td className="max-w-[120px] px-3 py-3">
                    {row.station_name ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    <div>{row.slot_date ?? "—"}</div>
                    <div className="font-mono text-xs text-zinc-600">
                      {slotTimeLine(row)}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <PaymentBadge method={row.payment_method} />
                  </td>
                  <td className="max-w-[120px] px-3 py-3 font-mono text-xs font-bold break-all">
                    {row.transaction_id ?? "—"}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">
                    {row.payment_number ?? "—"}
                  </td>
                  <td className="px-3 py-3 font-semibold">
                    {formatAmount(row.amount)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        disabled={actionBusyId === row.id}
                        onClick={() => void handleApprove(row)}
                        className="w-full min-w-[100px] rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={actionBusyId === row.id}
                        onClick={() => {
                          setRejectingId(
                            rejectingId === row.id ? null : row.id,
                          );
                          setRejectReason("");
                        }}
                        className="w-full min-w-[100px] rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
                {rejectingId === row.id && (
                  <tr className="bg-red-50/90">
                    <td colSpan={11} className="px-3 py-4">
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        rows={2}
                        className="w-full max-w-lg rounded-lg border border-red-200 bg-white px-3 py-2 text-sm"
                        placeholder="Reason (SMS to user)"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRejectSubmit(row.id)}
                          disabled={actionBusyId === row.id}
                          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason("");
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  const allTokensSection = (
    <section className="space-y-4">
      <h2 className="text-xl font-bold text-zinc-900">All tokens</h2>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "All"],
              ["pending", "Pending"],
              ["active", "Active"],
              ["used", "Used"],
              ["rejected", "Rejected"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTokenTab(key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                tokenTab === key
                  ? "bg-emerald-600 text-white shadow ring-2 ring-emerald-300"
                  : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name, phone, Trx ID…"
          className="w-full max-w-md rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              <th className="px-3 py-3">Token code</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Citizen</th>
              <th className="px-3 py-3">Station</th>
              <th className="px-3 py-3">Slot</th>
              <th className="px-3 py-3">Method</th>
              <th className="px-3 py-3">Trx ID</th>
              <th className="px-3 py-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {allTokens.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-zinc-500">
                  No tokens match.
                </td>
              </tr>
            )}
            {allTokens.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100">
                <td className="px-3 py-3">
                  <span className="rounded-lg bg-emerald-100 px-2 py-1 font-mono text-sm font-bold text-emerald-900">
                    {row.token_code ?? row.id.slice(0, 8)}
                  </span>
                </td>
                <td className="px-3 py-3">{statusBadge(row.status)}</td>
                <td className="px-3 py-3">
                  <div className="font-medium">{row.citizen_name ?? "—"}</div>
                  <div className="font-mono text-xs text-zinc-600">
                    {row.citizen_phone ?? "—"}
                  </div>
                </td>
                <td className="max-w-[140px] px-3 py-3">{row.station_name ?? "—"}</td>
                <td className="px-3 py-3">
                  <div>{row.slot_date ?? "—"}</div>
                  <div className="font-mono text-xs">{slotTimeLine(row)}</div>
                </td>
                <td className="px-3 py-3">
                  <PaymentBadge method={row.payment_method} />
                </td>
                <td className="max-w-[120px] px-3 py-3 font-mono text-xs font-bold break-all">
                  {row.transaction_id ?? "—"}
                </td>
                <td className="px-3 py-3 font-semibold">
                  {formatAmount(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  const citizensSection = (
    <section className="space-y-4">
      <h2 className="text-xl font-bold text-zinc-900">All citizens</h2>
      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Phone</th>
              <th className="px-3 py-3">License</th>
              <th className="px-3 py-3">Lock status</th>
              <th className="px-3 py-3">Total tokens</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {citizens.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-zinc-500">
                  No citizens.
                </td>
              </tr>
            )}
            {citizens.map((c) => {
              const locked = isLocked(c.locked_until);
              const cd = lockCountdown(c.locked_until);
              return (
                <tr key={c.id} className="border-b border-zinc-100">
                  <td className="px-3 py-3 font-medium text-zinc-900">
                    {c.full_name ?? "—"}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{c.phone}</td>
                  <td className="max-w-[120px] px-3 py-3 font-mono text-xs break-all">
                    {c.driving_license_number ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    {locked ? (
                      <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-900 ring-1 ring-orange-200">
                        {cd ?? "Locked"}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-emerald-700">
                        Unlocked
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-semibold">{c.total_tokens}</td>
                  <td className="px-3 py-3 text-right">
                    {locked && (
                      <button
                        type="button"
                        disabled={unlockBusyId === c.id}
                        onClick={() => void handleUnlock(c.id)}
                        className="rounded-lg border border-orange-400 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-900 hover:bg-orange-100 disabled:opacity-50"
                      >
                        {unlockBusyId === c.id ? "…" : "Unlock"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="min-h-dvh bg-zinc-100 pb-20 md:pb-0">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-dvh w-60 flex-col border-r border-zinc-200 bg-white shadow-sm md:flex">
        <div className="border-b border-zinc-100 px-4 py-5">
          <p className="text-lg font-bold text-zinc-900">FuelToken</p>
          <p className="text-xs text-zinc-500">Admin</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {navBtn("dashboard", "Dashboard", "home")}
          {navBtn("pending", "Pending", "clock")}
          {navBtn("tokens", "All Tokens", "list")}
          {navBtn("citizens", "Citizens", "users")}
        </nav>
        <div className="border-t border-zinc-100 p-3">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-xl border border-zinc-200 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="md:ml-60">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white/95 px-4 py-4 backdrop-blur md:px-8">
          <h1 className="text-lg font-bold text-zinc-900 md:text-xl">
            {nav === "dashboard" && "Dashboard"}
            {nav === "pending" && "Pending approvals"}
            {nav === "tokens" && "All tokens"}
            {nav === "citizens" && "Citizens"}
          </h1>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-700 md:hidden"
          >
            Log out
          </button>
        </header>

        <div className="space-y-10 px-4 py-8 md:px-8">
          {nav === "dashboard" && (
            <div className="space-y-6">
              {statsCards}
              <p className="text-sm text-zinc-600">
                Use the sidebar to review pending payments, browse tokens, or manage
                citizens.
              </p>
            </div>
          )}

          {nav === "pending" && (
            <div>
              {statsCards}
              <div className="mt-8">{pendingSection}</div>
            </div>
          )}

          {nav === "tokens" && (
            <div>
              {statsCards}
              <div className="mt-8">{allTokensSection}</div>
            </div>
          )}

          {nav === "citizens" && (
            <div>
              {statsCards}
              <div className="mt-8">{citizensSection}</div>
            </div>
          )}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(0,0,0,0.06)] md:hidden">
        {mobileNavBtn("dashboard", "Home", "home")}
        {mobileNavBtn("pending", "Pending", "clock")}
        {mobileNavBtn("tokens", "Tokens", "list")}
        {mobileNavBtn("citizens", "People", "users")}
      </nav>
    </div>
  );
}
