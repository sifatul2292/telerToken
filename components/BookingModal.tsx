"use client";

import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export type BookingStation = {
  id: string;
  name: string;
  fuel_types?: string[] | string | null;
};

export type BookingSlot = {
  id: string;
  station_id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
};

const BD_PHONE_RE = /^01[3-9]\d{8}$/;

function fuelTypeOptions(raw: BookingStation["fuel_types"]): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatSlotRange(start: string, end: string): string {
  return `${start.slice(0, 5)} – ${end.slice(0, 5)}`;
}

function randomOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

type ToastProps = {
  message: string;
  onDismiss: () => void;
};

function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[1200] w-[min(92vw,24rem)] -translate-x-1/2 rounded-2xl border border-zinc-200 bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white shadow-xl"
    >
      {message}
    </div>
  );
}

type BookingModalProps = {
  open: boolean;
  station: BookingStation | null;
  slot: BookingSlot | null;
  onClose: () => void;
};

export default function BookingModal({
  open,
  station,
  slot,
  onClose,
}: BookingModalProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [license, setLicense] = useState("");
  const [fuelType, setFuelType] = useState(() => {
    const opts = station ? fuelTypeOptions(station.fuel_types) : [];
    return opts.length === 1 ? opts[0]! : "";
  });
  const [otpSecret, setOtpSecret] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const options = station ? fuelTypeOptions(station.fuel_types) : [];

  const dismissToast = useCallback(() => setToast(null), []);

  const handleSendOtp = () => {
    setFormError(null);
    setBookingError(null);
    const name = fullName.trim();
    const ph = phone.replace(/\s/g, "");
    const lic = license.trim();
    if (name.length < 2) {
      setFormError("Please enter your full name.");
      return;
    }
    if (!BD_PHONE_RE.test(ph)) {
      setFormError("Enter a valid Bangladesh mobile number (11 digits, starts with 01).");
      return;
    }
    if (lic.length < 4) {
      setFormError("Please enter your driving license number.");
      return;
    }
    if (!options.length) {
      setFormError("This station has no fuel types configured.");
      return;
    }
    if (!fuelType) {
      setFormError("Select a fuel type.");
      return;
    }
    const code = randomOtp();
    setOtpSecret(code);
    setOtpSent(true);
    setOtpInput("");
    setToast(`Demo OTP: ${code}`);
  };

  const handleVerifyAndBook = async () => {
    if (!station || !slot || !otpSecret) return;
    setBookingError(null);
    if (otpInput.trim() !== otpSecret) {
      setBookingError("Incorrect OTP. Try again.");
      return;
    }

    setSubmitting(true);
    const ph = phone.replace(/\s/g, "");
    const lic = license.trim();
    const name = fullName.trim();
    const nowIso = new Date().toISOString();

    try {
      const { data: lockPhone } = await supabase
        .from("citizens")
        .select("id")
        .eq("phone", ph)
        .gt("locked_until", nowIso)
        .maybeSingle();

      const { data: lockLic } = await supabase
        .from("citizens")
        .select("id")
        .eq("driving_license_number", lic)
        .gt("locked_until", nowIso)
        .maybeSingle();

      if (lockPhone || lockLic) {
        setBookingError("You already have an active token");
        setSubmitting(false);
        return;
      }

      const lockUntil = new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: citizenRow, error: citizenErr } = await supabase
        .from("citizens")
        .upsert(
          {
            full_name: name,
            phone: ph,
            driving_license_number: lic,
            locked_until: lockUntil,
            updated_at: nowIso,
          },
          { onConflict: "phone" },
        )
        .select("id")
        .single();

      if (citizenErr || !citizenRow) {
        setBookingError(citizenErr?.message ?? "Could not save your profile.");
        setSubmitting(false);
        return;
      }

      const { data: tokenRow, error: tokenErr } = await supabase
        .from("tokens")
        .insert({
          citizen_id: citizenRow.id,
          station_id: station.id,
          time_slot_id: slot.id,
          fuel_type: fuelType,
        })
        .select("id")
        .single();

      if (tokenErr || !tokenRow) {
        setBookingError(tokenErr?.message ?? "Could not create your token.");
        setSubmitting(false);
        return;
      }

      const { data: slotRow, error: slotFetchErr } = await supabase
        .from("time_slots")
        .select("booked_count, capacity")
        .eq("id", slot.id)
        .single();

      if (slotFetchErr || !slotRow) {
        setBookingError(slotFetchErr?.message ?? "Could not update the slot.");
        setSubmitting(false);
        return;
      }

      const nextBooked = (slotRow.booked_count ?? 0) + 1;
      const cap = slotRow.capacity ?? 0;

      const { error: slotUpdErr } = await supabase
        .from("time_slots")
        .update({
          booked_count: nextBooked,
          ...(cap > 0 && nextBooked >= cap ? { is_booked: true } : {}),
        })
        .eq("id", slot.id);

      if (slotUpdErr) {
        setBookingError(slotUpdErr.message);
        setSubmitting(false);
        return;
      }

      onClose();
      router.push(`/token/${tokenRow.id}`);
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  if (!open || !station || !slot) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close booking"
        className="fixed inset-0 z-[1100] bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className="fuel-sheet-enter fixed inset-x-0 bottom-0 z-[1101] max-h-[min(92dvh,720px)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
      >
        <div className="mx-auto flex max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-200">
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1 w-10 rounded-full bg-zinc-300" />
          </div>
          <div className="max-h-[min(86dvh,680px)] overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="booking-title"
                  className="text-lg font-semibold text-zinc-900"
                >
                  Book slot
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {station.name} · {slot.slot_date} ·{" "}
                  {formatSlotRange(slot.start_time, slot.end_time)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
                aria-label="Close"
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

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Full name
                </span>
                <input
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none ring-emerald-600/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15"
                  placeholder="As on your license"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Phone number
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) =>
                    setPhone(e.target.value.replace(/[^\d]/g, "").slice(0, 11))
                  }
                  className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none ring-emerald-600/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15"
                  placeholder="01XXXXXXXXX"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Driving license number
                </span>
                <input
                  type="text"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none ring-emerald-600/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15"
                  placeholder="License number"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Fuel type
                </span>
                <select
                  value={fuelType}
                  onChange={(e) => setFuelType(e.target.value)}
                  disabled={!options.length}
                  className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none ring-emerald-600/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15 disabled:opacity-60"
                >
                  <option value="">
                    {options.length ? "Select fuel type" : "No types listed"}
                  </option>
                  {options.map((ft) => (
                    <option key={ft} value={ft}>
                      {ft}
                    </option>
                  ))}
                </select>
              </label>

              {formError && (
                <p className="text-sm text-red-600" role="alert">
                  {formError}
                </p>
              )}
              {bookingError && (
                <p className="text-sm text-red-600" role="alert">
                  {bookingError}
                </p>
              )}

              {!otpSent ? (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                >
                  Send OTP
                </button>
              ) : (
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Enter OTP
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={otpInput}
                      onChange={(e) =>
                        setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-center text-lg tracking-[0.3em] text-zinc-900 outline-none ring-emerald-600/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15"
                      placeholder="000000"
                      maxLength={6}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleVerifyAndBook}
                    className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                  >
                    {submitting ? "Booking…" : "Verify OTP"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast} onDismiss={dismissToast} />}
    </>
  );
}
