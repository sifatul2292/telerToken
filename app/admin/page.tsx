"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

type PendingRow = {
  id: string;
  token_code: string | null;
  payment_method: string | null;
  payment_number: string | null;
  transaction_id: string | null;
  payment_submitted_at: string | null;
  fuel_stations: { name: string } | null;
  time_slots: {
    slot_date: string;
    start_time: string;
    end_time: string;
  } | null;
  citizens: { full_name: string; phone: string } | null;
};

function formatPayMethod(raw: string | null): string {
  if (!raw) return "—";
  const m = raw.toLowerCase();
  if (m === "bkash") return "bKash";
  if (m === "nagad") return "Nagad";
  if (m === "rocket") return "Rocket";
  return raw;
}

function formatSlotTime(row: PendingRow): string {
  const t = row.time_slots;
  if (!t) return "—";
  const a = t.start_time.slice(0, 5);
  const b = t.end_time.slice(0, 5);
  return `${a} – ${b}`;
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    if (!password.trim()) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/pending-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(
          typeof data.error === "string" ? data.error : "Failed to load",
        );
        setRows([]);
        return;
      }
      setRows(Array.isArray(data.tokens) ? data.tokens : []);
      setUnlocked(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Network error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    if (!unlocked || !password) return;
    const t = setInterval(() => {
      void fetchPending();
    }, 60_000);
    return () => clearInterval(t);
  }, [unlocked, password, fetchPending]);

  const handleApprove = async (tokenId: string) => {
    setActionError(null);
    setActionBusyId(tokenId);
    try {
      const res = await fetch("/api/admin/approve-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId, adminPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(
          typeof data.error === "string" ? data.error : "Approve failed",
        );
        return;
      }
      await fetchPending();
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
      const res = await fetch("/api/admin/reject-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId,
          adminPassword: password,
          reason: rejectReason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(
          typeof data.error === "string" ? data.error : "Reject failed",
        );
        return;
      }
      setRejectingId(null);
      setRejectReason("");
      await fetchPending();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <div className="min-h-dvh bg-zinc-100 px-3 py-6 pb-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-semibold text-zinc-900">Admin</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Review manual payments and approve or reject tokens.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Admin password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full max-w-md rounded-xl border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-600/15"
              autoComplete="current-password"
            />
          </label>
          <button
            type="button"
            onClick={() => void fetchPending()}
            disabled={loading || !password.trim()}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load / refresh"}
          </button>
        </div>

        {loadError && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {loadError}
          </p>
        )}
        {actionError && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {actionError}
          </p>
        )}

        <section className="mt-10">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-zinc-900">
              Pending Approvals
            </h2>
            <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-amber-500 px-2.5 py-0.5 text-sm font-bold text-white">
              {rows.length}
            </span>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                  <th className="px-3 py-3">Citizen</th>
                  <th className="px-3 py-3">Phone</th>
                  <th className="px-3 py-3">Token</th>
                  <th className="px-3 py-3">Station</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Time</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3">Trx ID</th>
                  <th className="px-3 py-3">From #</th>
                  <th className="px-3 py-3">Submitted</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!unlocked && (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-3 py-8 text-center text-zinc-500"
                    >
                      Enter the admin password and click “Load / refresh”.
                    </td>
                  </tr>
                )}
                {rows.length === 0 && unlocked && !loading && (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-3 py-8 text-center text-zinc-500"
                    >
                      No pending approvals.
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-b border-zinc-100 align-top">
                      <td className="px-3 py-3 font-medium text-zinc-900">
                        {row.citizens?.full_name ?? "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-zinc-800">
                        {row.citizens?.phone ?? "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-800">
                        {row.token_code ?? row.id.slice(0, 8)}
                      </td>
                      <td className="max-w-[140px] px-3 py-3 text-zinc-800">
                        {row.fuel_stations?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-zinc-800">
                        {row.time_slots?.slot_date ?? "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-800">
                        {formatSlotTime(row)}
                      </td>
                      <td className="px-3 py-3">
                        {formatPayMethod(row.payment_method)}
                      </td>
                      <td className="max-w-[100px] px-3 py-3 font-mono text-xs break-all text-zinc-800">
                        {row.transaction_id ?? "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-800">
                        {row.payment_number ?? "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-zinc-600">
                        {row.payment_submitted_at
                          ? new Date(row.payment_submitted_at).toLocaleString(
                              "en-BD",
                              { dateStyle: "short", timeStyle: "short" },
                            )
                          : "—"}
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
                      <tr className="bg-red-50/80">
                        <td colSpan={11} className="px-3 py-4">
                          <p className="text-xs font-medium text-red-900">
                            Rejection reason (sent to user via SMS)
                          </p>
                          <textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            rows={2}
                            className="mt-2 w-full max-w-xl rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-zinc-900"
                            placeholder="e.g. Transaction ID not found in our statement"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void handleRejectSubmit(row.id)}
                              disabled={actionBusyId === row.id}
                              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Confirm reject
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
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
