"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

type CitizenEmbed = {
  full_name: string | null;
  phone: string | null;
  driving_license_number: string | null;
};

type TokenRow = {
  id: string;
  token_code: string | null;
  status: string;
  fuel_type: string | null;
  payment_method: string | null;
  payment_number: string | null;
  transaction_id: string | null;
  payment_submitted_at: string | null;
  amount: number | null;
  created_at?: string | null;
  fuel_stations: { name: string } | null;
  time_slots: {
    slot_date: string;
    start_time: string;
    end_time: string;
  } | null;
  citizens: CitizenEmbed | null;
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

function submittedAtIso(row: TokenRow): string | null {
  return row.payment_submitted_at ?? row.created_at ?? null;
}

function formatRelativeSubmitted(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} mins ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function formatSlotLines(row: TokenRow): { date: string; time: string } {
  const t = row.time_slots;
  if (!t) return { date: "—", time: "—" };
  const time = `${t.start_time.slice(0, 5)} – ${t.end_time.slice(0, 5)}`;
  return { date: t.slot_date, time };
}

function formatAmount(row: TokenRow): string {
  const n = row.amount;
  if (n != null && !Number.isNaN(Number(n))) return `৳${Number(n)}`;
  return "৳20";
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
  return (
    <span className="text-xs text-zinc-500">{method ?? "—"}</span>
  );
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

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState<TokenRow[]>([]);
  const [allTokens, setAllTokens] = useState<TokenRow[]>([]);
  const [citizens, setCitizens] = useState<CitizenAdmin[]>([]);

  const [tokenTab, setTokenTab] = useState<"all" | "active" | "used" | "rejected">(
    "all",
  );
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [unlockBusyId, setUnlockBusyId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400);
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
      setLoadError(
        typeof data.error === "string" ? data.error : "Failed to load tokens",
      );
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

  const refreshDashboard = useCallback(async () => {
    await Promise.all([fetchStats(), fetchPending(), fetchAllTokens(), fetchCitizens()]);
  }, [fetchStats, fetchPending, fetchAllTokens, fetchCitizens]);

  const handleLogin = async () => {
    setLoginError(null);
    setLoginLoading(true);
    try {
      const { res, data } = await postJson("/api/admin/stats", {});
      if (res.status === 401) {
        setLoginError("Invalid password.");
        setLoggedIn(false);
        return;
      }
      if (!res.ok) {
        setLoginError(
          typeof data.error === "string" ? data.error : "Login failed.",
        );
        setLoggedIn(false);
        return;
      }
      setLoggedIn(true);
      setStats({
        pendingTotal: data.pendingTotal ?? 0,
        activeToday: data.activeToday ?? 0,
        usedToday: data.usedToday ?? 0,
        rejectedTotal: data.rejectedTotal ?? 0,
      });
      await Promise.all([
        fetchPending(),
        fetchAllTokens(),
        fetchCitizens(),
      ]);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Login failed.");
      setLoggedIn(false);
    } finally {
      setLoginLoading(false);
    }
  };

  useEffect(() => {
    if (!loggedIn || !password) return;
    const t = setInterval(() => {
      void fetchPending();
    }, 30_000);
    return () => clearInterval(t);
  }, [loggedIn, password, fetchPending]);

  useEffect(() => {
    if (!loggedIn) return;
    void fetchAllTokens();
  }, [loggedIn, fetchAllTokens]);

  const handleApprove = async (tokenId: string) => {
    setActionError(null);
    setActionBusyId(tokenId);
    try {
      const { res, data } = await postJson("/api/admin/approve-token", {
        tokenId,
      });
      if (!res.ok) {
        setActionError(
          typeof data.error === "string" ? data.error : "Approve failed",
        );
        return;
      }
      await refreshDashboard();
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
      await refreshDashboard();
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

  if (!loggedIn) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-zinc-100 to-zinc-200 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl">
          <h1 className="text-center text-2xl font-bold tracking-tight text-zinc-900">
            FuelToken Admin
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-500">
            Sign in to manage tokens and citizens
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
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 outline-none ring-emerald-500/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/20"
              autoComplete="current-password"
              placeholder="••••••••"
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
            className="mt-6 flex w-full min-h-12 items-center justify-center rounded-xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {loginLoading ? "Signing in…" : "Login"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-100 pb-12">
      <header className="border-b border-zinc-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">
              Dashboard
            </h1>
            <p className="text-sm text-zinc-600">
              FuelToken operations overview
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoggedIn(false);
              setPassword("");
              setStats(null);
            }}
            className="self-start rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-10 px-4 pt-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Total pending
            </p>
            <p className="mt-2 text-3xl font-bold text-amber-950">
              {stats?.pendingTotal ?? "—"}
            </p>
            <p className="mt-1 text-xs text-amber-800/80">
              Awaiting payment or approval
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              Active tokens today
            </p>
            <p className="mt-2 text-3xl font-bold text-emerald-950">
              {stats?.activeToday ?? "—"}
            </p>
            <p className="mt-1 text-xs text-emerald-800/80">
              Slot date = today (Dhaka)
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
              Used today
            </p>
            <p className="mt-2 text-3xl font-bold text-zinc-900">
              {stats?.usedToday ?? "—"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Status = used (today)</p>
          </div>
          <div className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-rose-50 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-800">
              Total rejected
            </p>
            <p className="mt-2 text-3xl font-bold text-red-950">
              {stats?.rejectedTotal ?? "—"}
            </p>
            <p className="mt-1 text-xs text-red-800/80">All time</p>
          </div>
        </div>

        {actionError && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {actionError}
          </p>
        )}
        {loadError && (
          <p className="text-sm text-red-600" role="alert">
            {loadError}
          </p>
        )}

        {/* Pending Approvals */}
        <section>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold text-zinc-900 sm:text-xl">
              Pending Approvals
            </h2>
            <span className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full bg-orange-500 px-4 text-lg font-black text-white shadow-md ring-4 ring-orange-200">
              {pending.length}
            </span>
            {pendingLoading && (
              <span className="text-sm text-zinc-500">Refreshing…</span>
            )}
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[960px] border-collapse text-left text-sm">
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
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.length === 0 && !pendingLoading && (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-3 py-10 text-center text-zinc-500"
                    >
                      No pending approvals.
                    </td>
                  </tr>
                )}
                {pending.map((row) => {
                  const slot = formatSlotLines(row);
                  return (
                    <Fragment key={row.id}>
                      <tr className="border-b border-zinc-100 align-top">
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-zinc-600">
                          {formatRelativeSubmitted(
                            submittedAtIso(row),
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-zinc-900">
                            {row.citizens?.full_name ?? "—"}
                          </div>
                          <div className="font-mono text-xs text-zinc-600">
                            {row.citizens?.phone ?? "—"}
                          </div>
                        </td>
                        <td className="max-w-[120px] px-3 py-3 font-mono text-xs text-zinc-800">
                          {row.citizens?.driving_license_number ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-zinc-800">
                          {row.fuel_type ?? "—"}
                        </td>
                        <td className="max-w-[140px] px-3 py-3 text-zinc-800">
                          {row.fuel_stations?.name ?? "—"}
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-zinc-900">{slot.date}</div>
                          <div className="font-mono text-xs text-zinc-600">
                            {slot.time}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <PaymentBadge method={row.payment_method} />
                        </td>
                        <td className="max-w-[120px] px-3 py-3 font-mono text-xs font-bold break-all text-zinc-900">
                          {row.transaction_id ?? "—"}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-zinc-800">
                          {row.payment_number ?? "—"}
                        </td>
                        <td className="px-3 py-3 font-semibold text-zinc-900">
                          {formatAmount(row)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              disabled={actionBusyId === row.id}
                              onClick={() => void handleApprove(row.id)}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
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
                              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                      {rejectingId === row.id && (
                        <tr className="bg-red-50/90">
                          <td colSpan={11} className="px-3 py-4">
                            <p className="text-xs font-medium text-red-900">
                              Reason (SMS to user)
                            </p>
                            <textarea
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              rows={2}
                              className="mt-2 w-full max-w-lg rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-zinc-900"
                              placeholder="e.g. Transaction ID not found"
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleRejectSubmit(row.id)}
                                disabled={actionBusyId === row.id}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectingId(null);
                                  setRejectReason("");
                                }}
                                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* All Tokens */}
        <section>
          <h2 className="text-lg font-bold text-zinc-900 sm:text-xl">
            All Tokens
          </h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "All"],
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
              className="w-full max-w-md rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 sm:w-auto"
            />
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[1020px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Submitted</th>
                  <th className="px-3 py-3">Citizen</th>
                  <th className="px-3 py-3">License</th>
                  <th className="px-3 py-3">Fuel</th>
                  <th className="px-3 py-3">Station</th>
                  <th className="px-3 py-3">Slot</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3">Trx ID</th>
                  <th className="px-3 py-3">From</th>
                  <th className="px-3 py-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {allTokens.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-3 py-10 text-center text-zinc-500"
                    >
                      No tokens match this filter.
                    </td>
                  </tr>
                )}
                {allTokens.map((row) => {
                  const slot = formatSlotLines(row);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-zinc-100 align-top"
                    >
                      <td className="px-3 py-3">{statusBadge(row.status)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-zinc-600">
                        {formatRelativeSubmitted(submittedAtIso(row))}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-zinc-900">
                          {row.citizens?.full_name ?? "—"}
                        </div>
                        <div className="font-mono text-xs text-zinc-600">
                          {row.citizens?.phone ?? "—"}
                        </div>
                      </td>
                      <td className="max-w-[120px] px-3 py-3 font-mono text-xs">
                        {row.citizens?.driving_license_number ?? "—"}
                      </td>
                      <td className="px-3 py-3">{row.fuel_type ?? "—"}</td>
                      <td className="max-w-[140px] px-3 py-3">
                        {row.fuel_stations?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        <div>{slot.date}</div>
                        <div className="font-mono text-xs text-zinc-600">
                          {slot.time}
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
                        {formatAmount(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Citizens */}
        <section>
          <h2 className="text-lg font-bold text-zinc-900 sm:text-xl">
            All Citizens
          </h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Phone</th>
                  <th className="px-3 py-3">License</th>
                  <th className="px-3 py-3">Locked until</th>
                  <th className="px-3 py-3">Total tokens</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {citizens.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-10 text-center text-zinc-500"
                    >
                      No citizens loaded.
                    </td>
                  </tr>
                )}
                {citizens.map((c) => (
                  <tr key={c.id} className="border-b border-zinc-100">
                    <td className="px-3 py-3 font-medium text-zinc-900">
                      {c.full_name ?? "—"}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{c.phone}</td>
                    <td className="max-w-[140px] px-3 py-3 font-mono text-xs break-all">
                      {c.driving_license_number ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-zinc-700">
                      {c.locked_until
                        ? new Date(c.locked_until).toLocaleString("en-BD", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-3 font-semibold text-zinc-900">
                      {c.total_tokens}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        disabled={unlockBusyId === c.id || !c.locked_until}
                        onClick={() => void handleUnlock(c.id)}
                        className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-900 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {unlockBusyId === c.id ? "…" : "Unlock"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
