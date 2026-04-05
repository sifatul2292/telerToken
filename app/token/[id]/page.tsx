"use client";

import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type TokenRow = {
  id: string;
  fuel_type: string;
  created_at: string;
  fuel_stations: { name: string; address: string | null } | null;
  time_slots: {
    slot_date: string;
    start_time: string;
    end_time: string;
  } | null;
};

function formatTime(t: string): string {
  return t.slice(0, 5);
}

export default function TokenPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const [row, setRow] = useState<TokenRow | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const { data, error: qErr } = await supabase
        .from("tokens")
        .select(
          `
          id,
          fuel_type,
          created_at,
          fuel_stations ( name, address ),
          time_slots ( slot_date, start_time, end_time )
        `,
        )
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setRow(null);
        return;
      }
      setError(null);
      setRow(data as TokenRow | null);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-100 px-4 text-center">
        <p className="text-zinc-600">Missing token id.</p>
        <Link
          href="/"
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Back to map
        </Link>
      </div>
    );
  }

  if (row === undefined) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-zinc-100 px-4">
        <p className="text-zinc-600">Loading token…</p>
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-100 px-4 text-center">
        <p className="text-red-600">
          {error ?? "This token could not be found."}
        </p>
        <Link
          href="/"
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Back to map
        </Link>
      </div>
    );
  }

  const station = row.fuel_stations;
  const slot = row.time_slots;

  return (
    <div className="min-h-dvh bg-zinc-100 px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-md">
        <div className="rounded-3xl bg-white p-6 shadow-lg ring-1 ring-zinc-200">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Booking confirmed
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
            Your fuel token
          </h1>
          <p className="mt-1 font-mono text-sm text-zinc-500">{row.id}</p>

          <dl className="mt-6 space-y-4 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Station
              </dt>
              <dd className="mt-1 font-medium text-zinc-900">
                {station?.name ?? "—"}
              </dd>
              {station?.address && (
                <dd className="mt-0.5 text-zinc-600">{station.address}</dd>
              )}
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Slot
              </dt>
              <dd className="mt-1 text-zinc-900">
                {slot
                  ? `${slot.slot_date} · ${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Fuel type
              </dt>
              <dd className="mt-1 text-zinc-900">{row.fuel_type}</dd>
            </div>
          </dl>
        </div>

        <Link
          href="/"
          className="mt-6 flex min-h-12 w-full items-center justify-center rounded-2xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
        >
          Back to map
        </Link>
      </div>
    </div>
  );
}
