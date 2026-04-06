"use client";

import { supabase } from "@/lib/supabase";
import { useState } from "react";

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

const PAYMENT_BKASH =
  process.env.NEXT_PUBLIC_PAYMENT_BKASH_NUMBER ?? "01XXXXXXXXX";
const PAYMENT_NAGAD =
  process.env.NEXT_PUBLIC_PAYMENT_NAGAD_NUMBER ?? "01XXXXXXXXX";
const PAYMENT_ROCKET =
  process.env.NEXT_PUBLIC_PAYMENT_ROCKET_NUMBER ?? "01XXXXXXXXX";

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

function generateTokenCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += chars[Math.floor(Math.random() * chars.length)]!;
  }
  return s;
}

const DUPLICATE_MSG =
  "You already have an active or pending token. Please wait for approval or come back after your lock period ends.";

const VEHICLE_FEES = {
  motorcycle: 50,
  car_cng: 100,
} as const;

type VehicleType = keyof typeof VEHICLE_FEES;

type BookingModalProps = {
  open: boolean;
  station: BookingStation | null;
  slot: BookingSlot | null;
  onClose: () => void;
};

type Step = "form" | "payment" | "success";

export default function BookingModal({
  open,
  station,
  slot,
  onClose,
}: BookingModalProps) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [license, setLicense] = useState("");
  const [fuelType, setFuelType] = useState(() => {
    const opts = station ? fuelTypeOptions(station.fuel_types) : [];
    return opts.length === 1 ? opts[0]! : "";
  });
  const [vehicleType, setVehicleType] = useState<VehicleType>("motorcycle");
  const [step, setStep] = useState<Step>("form");
  const [formError, setFormError] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingTokenId, setPendingTokenId] = useState<string | null>(null);

  const [payMethod, setPayMethod] = useState<"bkash" | "nagad" | "rocket">(
    "bkash",
  );
  const [payFromNumber, setPayFromNumber] = useState("");
  const [trxId, setTrxId] = useState("");

  const options = station ? fuelTypeOptions(station.fuel_types) : [];
  const feeAmount = VEHICLE_FEES[vehicleType];

  async function citizenIdsMatchingPhoneOrLicense(
    ph: string,
    lic: string,
  ): Promise<string[]> {
    const { data: byPhone } = await supabase
      .from("citizens")
      .select("id")
      .eq("phone", ph);
    const { data: byLic } = await supabase
      .from("citizens")
      .select("id")
      .eq("driving_license_number", lic);
    const ids = new Set<string>();
    for (const r of byPhone ?? []) ids.add(r.id);
    for (const r of byLic ?? []) ids.add(r.id);
    return [...ids];
  }

  async function hasBlockingToken(citizenIds: string[]): Promise<boolean> {
    if (citizenIds.length === 0) return false;
    const { count, error } = await supabase
      .from("tokens")
      .select("*", { count: "exact", head: true })
      .in("citizen_id", citizenIds)
      .in("status", ["pending_payment", "pending_approval", "active"]);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  const handleSubmitForm = async () => {
    if (!station || !slot) return;
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
      setFormError(
        "Enter a valid Bangladesh mobile number (11 digits, starts with 01).",
      );
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

    setSubmitting(true);
    const bookingFee = VEHICLE_FEES[vehicleType];
    const nowIso = new Date().toISOString();

    try {
      const ids = await citizenIdsMatchingPhoneOrLicense(ph, lic);
      if (await hasBlockingToken(ids)) {
        setBookingError(DUPLICATE_MSG);
        setSubmitting(false);
        return;
      }

      const { data: citizenRow, error: citizenErr } = await supabase
        .from("citizens")
        .upsert(
          {
            full_name: name,
            phone: ph,
            driving_license_number: lic,
            fuel_type: fuelType,
            locked_until: null,
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

      if (await hasBlockingToken([citizenRow.id])) {
        setBookingError(DUPLICATE_MSG);
        setSubmitting(false);
        return;
      }

      let tokenCode = generateTokenCode();
      let tokenRow: { id: string } | null = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error: tokenErr } = await supabase
          .from("tokens")
          .insert({
            citizen_id: citizenRow.id,
            station_id: station.id,
            time_slot_id: slot.id,
            fuel_type: fuelType,
            token_code: tokenCode,
            status: "pending_payment",
            vehicle_type: vehicleType,
            amount: bookingFee,
          })
          .select("id")
          .single();

        if (!tokenErr && data) {
          tokenRow = data;
          break;
        }
        if (
          tokenErr?.message?.includes("duplicate") ||
          tokenErr?.code === "23505"
        ) {
          tokenCode = generateTokenCode();
          continue;
        }
        setBookingError(tokenErr?.message ?? "Could not create your token.");
        setSubmitting(false);
        return;
      }

      if (!tokenRow) {
        setBookingError("Could not create your token.");
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

      setPendingTokenId(tokenRow.id);
      setPayFromNumber(ph);
      setStep("payment");
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitPayment = async () => {
    if (!pendingTokenId) return;
    setBookingError(null);
    const from = payFromNumber.replace(/\s/g, "");
    const tid = trxId.trim();
    if (!BD_PHONE_RE.test(from)) {
      setBookingError("Enter the mobile number you paid from (11 digits).");
      return;
    }
    if (tid.length < 4) {
      setBookingError("Enter the transaction ID from your SMS.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/submit-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: pendingTokenId,
          paymentMethod: payMethod,
          paymentNumber: from,
          transactionId: tid,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBookingError(
          typeof data.error === "string" ? data.error : "Payment submit failed.",
        );
        setSubmitting(false);
        return;
      }
      setStep("success");
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
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
                  {step === "success" ? "All set" : "Book slot"}
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

            {step === "success" ? (
              <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-5 text-center">
                <p className="text-base font-medium text-emerald-950">
                  Payment submitted! We will review your transaction and send you
                  an SMS confirmation within 30 minutes.
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-5 w-full rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Close
                </button>
              </div>
            ) : step === "payment" ? (
              <div className="mt-5 space-y-4">
                <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-950">
                  Send exactly ৳{feeAmount} — then enter your transaction ID
                  below.
                </p>
                <p className="text-center text-base font-medium text-zinc-900">
                  Use bKash, Nagad, or Rocket to send ৳{feeAmount} to any of
                  these numbers:
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      bKash
                    </p>
                    <p className="mt-1 font-mono text-sm font-medium text-zinc-900">
                      {PAYMENT_BKASH}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Nagad
                    </p>
                    <p className="mt-1 font-mono text-sm font-medium text-zinc-900">
                      {PAYMENT_NAGAD}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center shadow-sm sm:col-span-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Rocket
                    </p>
                    <p className="mt-1 font-mono text-sm font-medium text-zinc-900">
                      {PAYMENT_ROCKET}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-zinc-600">
                  After sending exactly ৳{feeAmount}, enter your payment details
                  below.
                </p>

                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Paid with
                  </span>
                  <select
                    value={payMethod}
                    onChange={(e) =>
                      setPayMethod(e.target.value as typeof payMethod)
                    }
                    className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15"
                  >
                    <option value="bkash">bKash</option>
                    <option value="nagad">Nagad</option>
                    <option value="rocket">Rocket</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Your mobile number you sent from
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={payFromNumber}
                    onChange={(e) =>
                      setPayFromNumber(
                        e.target.value.replace(/\D/g, "").slice(0, 11),
                      )
                    }
                    className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15"
                    placeholder="01XXXXXXXXX"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Transaction ID
                  </span>
                  <input
                    type="text"
                    value={trxId}
                    onChange={(e) => setTrxId(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15"
                    placeholder="TrxID from payment SMS"
                  />
                </label>

                {bookingError && (
                  <p className="text-sm text-red-600" role="alert">
                    {bookingError}
                  </p>
                )}

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmitPayment}
                  className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Submit Payment"}
                </button>
              </div>
            ) : (
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
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))
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

                <fieldset className="space-y-2">
                  <legend className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Vehicle type
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setVehicleType("motorcycle")}
                      className={`rounded-xl border-2 px-4 py-3 text-left transition ${
                        vehicleType === "motorcycle"
                          ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-200"
                          : "border-zinc-200 bg-zinc-50 hover:border-zinc-300"
                      }`}
                    >
                      <span className="block font-semibold text-zinc-900">
                        Motorcycle
                      </span>
                      <span className="text-sm text-emerald-700">৳50</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVehicleType("car_cng")}
                      className={`rounded-xl border-2 px-4 py-3 text-left transition ${
                        vehicleType === "car_cng"
                          ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-200"
                          : "border-zinc-200 bg-zinc-50 hover:border-zinc-300"
                      }`}
                    >
                      <span className="block font-semibold text-zinc-900">
                        Car / CNG
                      </span>
                      <span className="text-sm text-emerald-700">৳100</span>
                    </button>
                  </div>
                </fieldset>

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

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmitForm}
                  className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
