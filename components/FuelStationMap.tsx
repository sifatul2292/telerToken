"use client";

import BookingModal from "@/components/BookingModal";
import { supabase } from "@/lib/supabase";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer } from "react-leaflet";

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
};

const DHAKA_CENTER: [number, number] = [23.8103, 90.4125];
const ZOOM = 13;
const ALMOST_FULL_RATIO = 0.8;

function todayDhakaYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function stationPosition(row: FuelStationRow): [number, number] | null {
  const lat = row.lat ?? row.latitude;
  const lng = row.lng ?? row.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return [lat, lng];
}

function markerVariant(row: FuelStationRow): "green" | "amber" | "red" {
  const cap = row.capacity;
  const booked = row.booked_count ?? 0;
  if (cap == null || cap <= 0) return "green";
  if (booked >= cap) return "red";
  if (booked / cap >= ALMOST_FULL_RATIO) return "amber";
  return "green";
}

const PIN_COLORS = {
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
} as const;

function makePinIcon(variant: "green" | "amber" | "red") {
  const fill = PIN_COLORS[variant];
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
      <path fill="${fill}" stroke="#fff" stroke-width="2" d="M16 2C9.4 2 4 7.2 4 13.6c0 9.4 12 24.4 12 24.4s12-15 12-24.4C28 7.2 22.6 2 16 2z"/>
      <circle cx="16" cy="14" r="5" fill="#fff"/>
    </svg>`,
  );
  return L.divIcon({
    className: "fuel-map-pin",
    html: `<img src="data:image/svg+xml,${svg}" width="32" height="42" alt="" />`,
    iconSize: [32, 42],
    iconAnchor: [16, 42],
  });
}

const pinIcons = {
  green: makePinIcon("green"),
  amber: makePinIcon("amber"),
  red: makePinIcon("red"),
} as const;

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

function slotIsBookable(row: TimeSlotRow): boolean {
  if (row.is_available === false) return false;
  if (row.is_booked === true) return false;
  return true;
}

export default function FuelStationMap() {
  const [stations, setStations] = useState<FuelStationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingStations, setLoadingStations] = useState(true);

  const [selected, setSelected] = useState<FuelStationRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
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

  const openStation = useCallback((row: FuelStationRow) => {
    setSelected(row);
    setSheetOpen(true);
    setSelectedSlotId(null);
    setSlots([]);
    setSlotsError(null);
  }, []);

  useEffect(() => {
    if (!selected?.id || !sheetOpen) return;
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
  }, [selected?.id, sheetOpen, today]);

  const availableSlots = useMemo(
    () => slots.filter(slotIsBookable),
    [slots],
  );

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setSelectedSlotId(null);
    setBookingOpen(false);
  }, []);

  const bookingSlot = useMemo(() => {
    if (!selectedSlotId) return null;
    return availableSlots.find((s) => s.id === selectedSlotId) ?? null;
  }, [availableSlots, selectedSlotId]);

  const closeBooking = useCallback(() => {
    setBookingOpen(false);
  }, []);

  return (
    <div className="relative h-dvh w-full bg-zinc-100">
      <MapContainer
        center={DHAKA_CENTER}
        zoom={ZOOM}
        className="h-full w-full z-0"
        scrollWheelZoom
        zoomControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {stations.map((row) => {
          const pos = stationPosition(row);
          if (!pos) return null;
          const v = markerVariant(row);
          return (
            <Marker
              key={row.id}
              position={pos}
              icon={pinIcons[v]}
              eventHandlers={{
                click: () => openStation(row),
              }}
            />
          );
        })}
      </MapContainer>

      {(loadingStations || loadError) && (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-[500] flex justify-center">
          <div className="pointer-events-auto max-w-md rounded-xl border border-zinc-200 bg-white/95 px-4 py-2 text-center text-sm text-zinc-800 shadow-lg backdrop-blur-sm">
            {loadingStations && "Loading stations…"}
            {!loadingStations && loadError && (
              <span className="text-red-600">Stations: {loadError}</span>
            )}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-4 left-3 right-3 z-[500] flex justify-center gap-2 text-xs text-zinc-600">
        <span className="pointer-events-auto rounded-full bg-white/95 px-3 py-1.5 shadow backdrop-blur-sm">
          <span className="mr-1 inline-block size-2 rounded-full bg-green-600 align-middle" />{" "}
          Open
        </span>
        <span className="pointer-events-auto rounded-full bg-white/95 px-3 py-1.5 shadow backdrop-blur-sm">
          <span className="mr-1 inline-block size-2 rounded-full bg-amber-600 align-middle" />{" "}
          Almost full
        </span>
        <span className="pointer-events-auto rounded-full bg-white/95 px-3 py-1.5 shadow backdrop-blur-sm">
          <span className="mr-1 inline-block size-2 rounded-full bg-red-600 align-middle" />{" "}
          Full
        </span>
      </div>

      {sheetOpen && selected && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-[1px]"
            onClick={closeSheet}
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
                    onClick={closeSheet}
                    className="shrink-0 rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
                    aria-label="Close panel"
                  >
                    <svg
                      className="size-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
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
