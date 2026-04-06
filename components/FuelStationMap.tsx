"use client";

import BookingModal from "@/components/BookingModal";
import { supabase } from "@/lib/supabase";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";

type FuelStationRow = {
  id: string;
  name: string;
  address: string | null;
  lat?: number | null;
  lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  booked_count?: number | null;
  capacity?: number | null;
  fuel_types?: string[] | string | null;
};

type TimeSlotRow = {
  id: string;
  station_id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  is_available?: boolean | null;
  is_booked?: boolean | null;
  capacity?: number | null;
  booked_count?: number | null;
};

type FilterChip =
  | "all"
  | "open"
  | "octane"
  | "diesel"
  | "cng"
  | "near_me";

type InfoTab = "how" | "pricing" | "near";

const DHAKA_CENTER: [number, number] = [23.8103, 90.4125];
const ZOOM = 13;

const PIN_COLORS = {
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
} as const;

function todayDhakaYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dhakaDayBoundsIso(): { start: string; end: string } {
  const ymd = todayDhakaYmd();
  return {
    start: new Date(`${ymd}T00:00:00+06:00`).toISOString(),
    end: new Date(`${ymd}T23:59:59.999+06:00`).toISOString(),
  };
}

function stationPosition(row: FuelStationRow): [number, number] | null {
  const lat = row.lat ?? row.latitude;
  const lng = row.lng ?? row.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return [lat, lng];
}

function haversineKm(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function fuelTypesNorm(row: FuelStationRow): string {
  const raw = row.fuel_types;
  if (raw == null) return "";
  if (Array.isArray(raw)) return raw.join(" ").toLowerCase();
  return String(raw).toLowerCase();
}

function slotIsOpen(row: TimeSlotRow): boolean {
  if (row.is_available === false) return false;
  if (row.is_booked === true) return false;
  const cap = row.capacity ?? 0;
  const booked = row.booked_count ?? 0;
  if (cap <= 0) return true;
  return booked < cap;
}

function openSlotCountForStation(
  stationId: string,
  slots: TimeSlotRow[],
): number {
  return slots.filter((s) => s.station_id === stationId && slotIsOpen(s))
    .length;
}

function pinVariant(openCount: number): "green" | "amber" | "red" {
  if (openCount === 0) return "red";
  if (openCount > 5) return "green";
  return "amber";
}

function makeLabeledPinIcon(openCount: number): L.DivIcon {
  const variant = pinVariant(openCount);
  const fill = PIN_COLORS[variant];
  const label = openCount === 0 ? "Full" : `${openCount} slots`;
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
      <path fill="${fill}" stroke="#fff" stroke-width="2" d="M16 2C9.4 2 4 7.2 4 13.6c0 9.4 12 24.4 12 24.4s12-15 12-24.4C28 7.2 22.6 2 16 2z"/>
      <circle cx="16" cy="14" r="5" fill="#fff"/>
    </svg>`,
  );
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;width:max-content;transform:translateX(-50%);margin-left:16px;">
      <img src="data:image/svg+xml,${svg}" width="32" height="42" alt="" />
      <span style="margin-top:2px;font-size:10px;font-weight:700;line-height:1.1;padding:3px 8px;border-radius:9999px;background:#fff;border:1px solid #e4e4e7;color:#18181b;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.08);">${label}</span>
    </div>`;
  return L.divIcon({
    className: "fuel-map-pin-wrap",
    html,
    iconSize: [72, 58],
    iconAnchor: [36, 42],
  });
}

function formatFuelTypes(raw: FuelStationRow["fuel_types"]): string {
  if (raw == null) return "—";
  if (Array.isArray(raw)) return raw.length ? raw.join(", ") : "—";
  const s = String(raw).trim();
  return s || "—";
}

function formatSlotRange(start: string, end: string): string {
  const a = start.slice(0, 5);
  const b = end.slice(0, 5);
  return `${a} – ${b}`;
}

function MapResize({ open }: { open: boolean }) {
  const map = useMap();
  useEffect(() => {
    window.setTimeout(() => map.invalidateSize(), 200);
  }, [map, open]);
  return null;
}

export default function FuelStationMap() {
  const [stations, setStations] = useState<FuelStationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingStations, setLoadingStations] = useState(true);
  const [todaySlots, setTodaySlots] = useState<TimeSlotRow[]>([]);
  const [tokensToday, setTokensToday] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<FilterChip>("all");
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [infoTab, setInfoTab] = useState<InfoTab>("how");
  const [infoSheetOpen, setInfoSheetOpen] = useState(true);

  const [selected, setSelected] = useState<FuelStationRow | null>(null);
  const [stationSheetOpen, setStationSheetOpen] = useState(false);
  const [slots, setSlots] = useState<TimeSlotRow[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);

  const today = useMemo(() => todayDhakaYmd(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingStations(true);
      setLoadError(null);
      const { data, error } = await supabase.from("fuel_stations").select("*");
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setStations([]);
      } else {
        setStations((data as FuelStationRow[]) ?? []);
      }
      setLoadingStations(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("time_slots")
        .select("*")
        .eq("slot_date", today);
      if (cancelled) return;
      if (!error) setTodaySlots((data as TimeSlotRow[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [today]);

  const fetchTokensToday = useCallback(async () => {
    const { start, end } = dhakaDayBoundsIso();
    const { count, error } = await supabase
      .from("tokens")
      .select("*", { count: "exact", head: true })
      .gte("created_at", start)
      .lte("created_at", end);
    if (!error) setTokensToday(count ?? 0);
  }, []);

  useEffect(() => {
    const id0 = window.setTimeout(() => {
      void fetchTokensToday();
    }, 0);
    const t = window.setInterval(() => void fetchTokensToday(), 60_000);
    return () => {
      clearTimeout(id0);
      clearInterval(t);
    };
  }, [fetchTokensToday]);

  useEffect(() => {
    if (chip !== "near_me") return;
    if (!navigator.geolocation) {
      const tid = window.setTimeout(
        () => setGeoError("Location not supported"),
        0,
      );
      return () => clearTimeout(tid);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos([pos.coords.latitude, pos.coords.longitude]);
        setGeoError(null);
      },
      () => {
        window.setTimeout(() => setGeoError("Could not get location"), 0);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, [chip]);

  useEffect(() => {
    if (infoTab !== "near") return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos([pos.coords.latitude, pos.coords.longitude]);
        setGeoError(null);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, [infoTab]);

  const openByStation = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stations) {
      m.set(s.id, openSlotCountForStation(s.id, todaySlots));
    }
    return m;
  }, [stations, todaySlots]);

  const filteredStations = useMemo(() => {
    let list = stations.filter((s) => stationPosition(s));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((s) => s.name.toLowerCase().includes(q));

    if (chip === "open") {
      list = list.filter((s) => (openByStation.get(s.id) ?? 0) > 0);
    } else if (chip === "octane") {
      list = list.filter((s) => fuelTypesNorm(s).includes("octane"));
    } else if (chip === "diesel") {
      list = list.filter((s) => fuelTypesNorm(s).includes("diesel"));
    } else if (chip === "cng") {
      list = list.filter((s) => fuelTypesNorm(s).includes("cng"));
    } else if (chip === "near_me" && userPos) {
      list = [...list].sort((a, b) => {
        const pa = stationPosition(a)!;
        const pb = stationPosition(b)!;
        return haversineKm(userPos, pa) - haversineKm(userPos, pb);
      });
    }

    return list;
  }, [stations, search, chip, openByStation, userPos]);

  const nearMeSorted = useMemo(() => {
    const list = stations.filter((s) => stationPosition(s));
    if (!userPos) return list;
    return [...list].sort((a, b) => {
      const pa = stationPosition(a)!;
      const pb = stationPosition(b)!;
      return haversineKm(userPos, pa) - haversineKm(userPos, pb);
    });
  }, [stations, userPos]);

  const openStation = useCallback((row: FuelStationRow) => {
    setSelected(row);
    setStationSheetOpen(true);
    setInfoSheetOpen(false);
    setSelectedSlotId(null);
    setSlots([]);
    setSlotsError(null);
  }, []);

  useEffect(() => {
    if (!selected?.id || !stationSheetOpen) return;
    let cancelled = false;
    (async () => {
      setSlotsLoading(true);
      setSlotsError(null);
      const { data, error } = await supabase
        .from("time_slots")
        .select("*")
        .eq("station_id", selected.id)
        .eq("slot_date", today)
        .order("start_time", { ascending: true });
      if (cancelled) return;
      if (error) {
        setSlotsError(error.message);
        setSlots([]);
      } else {
        setSlots((data as TimeSlotRow[]) ?? []);
      }
      setSlotsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, stationSheetOpen, today]);

  const availableSlots = useMemo(() => slots.filter(slotIsOpen), [slots]);

  const closeStationSheet = useCallback(() => {
    setStationSheetOpen(false);
    setSelectedSlotId(null);
    setBookingOpen(false);
    setInfoSheetOpen(true);
  }, []);

  const bookingSlot = useMemo(() => {
    if (!selectedSlotId) return null;
    return availableSlots.find((s) => s.id === selectedSlotId) ?? null;
  }, [availableSlots, selectedSlotId]);

  const closeBooking = useCallback(() => {
    setBookingOpen(false);
  }, []);

  const chipClass = (c: FilterChip) =>
    `shrink-0 snap-start rounded-full px-4 py-2 text-sm font-semibold transition ${
      chip === c
        ? "bg-emerald-600 text-white shadow"
        : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50"
    }`;

  return (
    <div className="relative flex h-dvh w-full flex-col bg-zinc-100">
      {/* Top bar */}
      <header className="z-[600] shrink-0 border-b border-zinc-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight text-zinc-900">
            FuelToken BD
          </h1>
          <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 ring-1 ring-emerald-200">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-emerald-900">
              {tokensToday == null ? "…" : tokensToday} tokens today
            </span>
          </div>
        </div>
        <div className="px-4 pb-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stations by name…"
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 [-webkit-overflow-scrolling:touch]">
          <button type="button" className={chipClass("all")} onClick={() => setChip("all")}>
            All
          </button>
          <button type="button" className={chipClass("open")} onClick={() => setChip("open")}>
            Open slots
          </button>
          <button type="button" className={chipClass("octane")} onClick={() => setChip("octane")}>
            Octane
          </button>
          <button type="button" className={chipClass("diesel")} onClick={() => setChip("diesel")}>
            Diesel
          </button>
          <button type="button" className={chipClass("cng")} onClick={() => setChip("cng")}>
            CNG
          </button>
          <button type="button" className={chipClass("near_me")} onClick={() => setChip("near_me")}>
            Near me
          </button>
        </div>
        {geoError && chip === "near_me" && (
          <p className="px-4 pb-2 text-xs text-amber-700">{geoError}</p>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        <MapContainer
          center={userPos ?? DHAKA_CENTER}
          zoom={ZOOM}
          className="h-full w-full z-0"
          scrollWheelZoom
          zoomControl
        >
          <MapResize open={infoSheetOpen || stationSheetOpen} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {filteredStations.map((row) => {
            const pos = stationPosition(row);
            if (!pos) return null;
            const openCount = openByStation.get(row.id) ?? 0;
            return (
              <Marker
                key={row.id}
                position={pos}
                icon={makeLabeledPinIcon(openCount)}
                eventHandlers={{
                  click: () => openStation(row),
                }}
              />
            );
          })}
        </MapContainer>

        {(loadingStations || loadError) && (
          <div className="pointer-events-none absolute left-3 right-3 top-3 z-[500] flex justify-center">
            <div className="pointer-events-auto max-w-md rounded-xl border border-zinc-200 bg-white/95 px-4 py-2 text-center text-sm shadow-lg">
              {loadingStations && "Loading stations…"}
              {!loadingStations && loadError && (
                <span className="text-red-600">{loadError}</span>
              )}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-[calc(13rem+env(safe-area-inset-bottom))] left-3 right-3 z-[500] flex flex-wrap justify-center gap-2 text-[10px] text-zinc-600 md:bottom-4">
          <span className="pointer-events-auto rounded-full bg-white/95 px-2 py-1 shadow">
            <span className="mr-1 inline-block size-2 rounded-full bg-green-600 align-middle" />{" "}
            &gt;5 slots
          </span>
          <span className="pointer-events-auto rounded-full bg-white/95 px-2 py-1 shadow">
            <span className="mr-1 inline-block size-2 rounded-full bg-amber-600 align-middle" />{" "}
            1–4 slots
          </span>
          <span className="pointer-events-auto rounded-full bg-white/95 px-2 py-1 shadow">
            <span className="mr-1 inline-block size-2 rounded-full bg-red-600 align-middle" />{" "}
            Full
          </span>
        </div>
      </div>

      {/* Info bottom sheet — 3 tabs */}
      {infoSheetOpen && !stationSheetOpen && (
        <>
          <button
            type="button"
            aria-label="Dismiss info"
            className="fixed inset-0 z-[900] bg-black/25"
            onClick={() => setInfoSheetOpen(false)}
          />
          <div className="fuel-sheet-enter fixed inset-x-0 bottom-0 z-[901] max-h-[55dvh] rounded-t-3xl border border-zinc-200 bg-white shadow-2xl md:mx-auto md:max-w-lg">
            <div className="flex justify-center pt-2">
              <div className="h-1 w-10 rounded-full bg-zinc-300" />
            </div>
            <div className="flex border-b border-zinc-100 px-2">
              {(
                [
                  ["how", "How it works"],
                  ["pricing", "Pricing"],
                  ["near", "Near me"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setInfoTab(id)}
                  className={`flex-1 py-3 text-center text-sm font-semibold ${
                    infoTab === id
                      ? "border-b-2 border-emerald-600 text-emerald-800"
                      : "text-zinc-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="max-h-[min(42dvh,360px)] overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
              {infoTab === "how" && (
                <ol className="space-y-4">
                  {[
                    {
                      n: 1,
                      t: "Tap a station",
                      s: "Choose a fuel station on the map.",
                      icon: (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      ),
                    },
                    {
                      n: 2,
                      t: "Pick time slot",
                      s: "Select an available window for today.",
                      icon: (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      ),
                    },
                    {
                      n: 3,
                      t: "Fill details and pay",
                      s: "Enter your info and pay via bKash/Nagad.",
                      icon: (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      ),
                    },
                    {
                      n: 4,
                      t: "Get SMS confirmation",
                      s: "We approve and text you the token code.",
                      icon: (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      ),
                    },
                  ].map((step) => (
                    <li key={step.n} className="flex gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                        <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          {step.icon}
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-emerald-700">
                          Step {step.n}
                        </p>
                        <p className="font-semibold text-zinc-900">{step.t}</p>
                        <p className="text-sm text-zinc-600">{step.s}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {infoTab === "pricing" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-center shadow-sm">
                      <p className="text-xs font-semibold uppercase text-zinc-500">
                        Motorcycle
                      </p>
                      <p className="mt-2 text-2xl font-bold text-zinc-900">৳50</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-center shadow-sm">
                      <p className="text-xs font-semibold uppercase text-zinc-500">
                        Car / CNG
                      </p>
                      <p className="mt-2 text-2xl font-bold text-zinc-900">৳100</p>
                    </div>
                  </div>
                  <p className="text-center text-sm text-zinc-600">
                    Pay via bKash/Nagad after booking. Approved within 30 minutes.
                  </p>
                </div>
              )}
              {infoTab === "near" && (
                <div className="space-y-2">
                  {!userPos && (
                    <p className="text-sm text-zinc-600">
                      Turn on location or use the &quot;Near me&quot; filter to sort
                      by distance.
                    </p>
                  )}
                  {nearMeSorted.map((st) => {
                    const pos = stationPosition(st)!;
                    const dist =
                      userPos != null
                        ? `${haversineKm(userPos, pos).toFixed(1)} km`
                        : "—";
                    const open = openByStation.get(st.id) ?? 0;
                    const total = todaySlots.filter((x) => x.station_id === st.id).length || 1;
                    const pct = Math.min(100, Math.round((open / total) * 100));
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => openStation(st)}
                        className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50/50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-zinc-900">
                            {st.name}
                          </span>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {dist}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span
                            className={`text-sm font-bold ${
                              open === 0 ? "text-red-600" : "text-emerald-700"
                            }`}
                          >
                            {open} open
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-zinc-600">
                          {formatFuelTypes(st.fuel_types)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!infoSheetOpen && !stationSheetOpen && (
        <button
          type="button"
          onClick={() => setInfoSheetOpen(true)}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[902] -translate-x-1/2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg md:bottom-8"
        >
          How it works & pricing
        </button>
      )}

      {/* Station booking sheet */}
      {stationSheetOpen && selected && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-[1px]"
            onClick={closeStationSheet}
          />
          <div
            className="fuel-sheet-enter fixed inset-x-0 bottom-0 z-[1001] max-h-[min(88dvh,640px)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
          >
            <div className="mx-auto flex max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-200">
              <div className="flex justify-center pt-2 pb-1">
                <div className="h-1 w-10 rounded-full bg-zinc-300" />
              </div>
              <div className="max-h-[min(80dvh,560px)] overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2
                      id="sheet-title"
                      className="text-lg font-semibold leading-snug text-zinc-900"
                    >
                      {selected.name}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      {selected.address?.trim() || "Address not listed"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeStationSheet}
                    className="shrink-0 rounded-full p-2 text-zinc-500 hover:bg-zinc-100"
                    aria-label="Close panel"
                  >
                    <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Fuel types
                </p>
                <p className="mt-1 text-sm text-zinc-800">
                  {formatFuelTypes(selected.fuel_types)}
                </p>

                <p className="mt-5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Available slots today ({today})
                </p>
                <div className="mt-2 min-h-[3rem]">
                  {slotsLoading && (
                    <p className="text-sm text-zinc-500">Loading slots…</p>
                  )}
                  {!slotsLoading && slotsError && (
                    <p className="text-sm text-red-600">{slotsError}</p>
                  )}
                  {!slotsLoading &&
                    !slotsError &&
                    availableSlots.length === 0 && (
                      <p className="text-sm text-zinc-500">
                        No open slots for this date.
                      </p>
                    )}
                  {!slotsLoading && !slotsError && availableSlots.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {availableSlots.map((slot) => {
                        const active = selectedSlotId === slot.id;
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => {
                              setSelectedSlotId(slot.id);
                              setBookingOpen(true);
                            }}
                            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition active:scale-[0.98] ${
                              active
                                ? "border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-600/30"
                                : "border-zinc-200 bg-zinc-50 text-zinc-800 hover:border-zinc-300"
                            }`}
                          >
                            {formatSlotRange(slot.start_time, slot.end_time)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <BookingModal
        key={
          bookingOpen && bookingSlot && selected
            ? `${selected.id}-${bookingSlot.id}`
            : "booking-idle"
        }
        open={bookingOpen && !!selected && !!bookingSlot}
        station={selected}
        slot={bookingSlot}
        onClose={closeBooking}
      />
    </div>
  );
}
