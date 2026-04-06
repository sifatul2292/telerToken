"use client";

import { supabase } from "@/lib/supabase";
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

function randomOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateTokenCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += chars[Math.floor(Math.random() * chars.length)]!;
  }
  return s;
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

type Step = "details" | "otp" | "payment" | "success";

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
  const [otpSecret, setOtpSecret] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [step, setStep] = useState<Step>("details");
  const [toast, setToast] = useState<string | null>(null);
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
    const code = randomOtp();
    setOtpSecret(code);
    setOtpInput("");
    setStep("otp");
    setToast(`Demo OTP: ${code}`);
  };

  const createReservationAfterOtp = async () => {
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

      const { data: existingCitizen } = await supabase
        .from("citizens")
        .select("id")
        .eq("phone", ph)
        .maybeSingle();

      if (existingCitizen) {
        const { count } = await supabase
          .from("tokens")
          .select("*", { count: "exact", head: true })
          .eq("citizen_id", existingCitizen.id)
          .in("status", ["pending_payment", "pending_approval", "active"]);

        if (count && count > 0) {
          setBookingError("You already have an active token");
          setSubmitting(false);
          return;
        }
      }

      const { data: citizenRow, error: citizenErr } = await supabase
        .from("citizens")
        .upsert(
          {
            full_name: name,
            phone: ph,
            driving_license_number: lic,
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

      const { count: openCount } = await supabase
        .from("tokens")
        .select("*", { count: "exact", head: true })
        .eq("citizen_id", citizenRow.id)
        .in("status", ["pending_payment", "pending_approval", "active"]);

      if (openCount && openCount > 0) {
        setBookingError("You already have an active token");
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
                  Payment submitted! We will review and send you an SMS
                  confirmation within 30 minutes.
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
                <p className="text-center text-base font-medium text-zinc-900">
                  To confirm your slot, send ৳20 to any of these numbers:
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
                  After sending, enter your transaction details below
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
                  {submitting ? "Submitting…" : "Submit payment"}
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
                    disabled={step === "otp"}
                    className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none ring-emerald-600/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15 disabled:opacity-70"
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
                    disabled={step === "otp"}
                    className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none ring-emerald-600/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15 disabled:opacity-70"
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
                    disabled={step === "otp"}
                    className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 outline-none ring-emerald-600/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15 disabled:opacity-70"
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
                    disabled={!options.length || step === "otp"}
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

                {step === "details" ? (
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
                          setOtpInput(
                            e.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-center text-lg tracking-[0.3em] text-zinc-900 outline-none ring-emerald-600/0 transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-600/15"
                        placeholder="000000"
                        maxLength={6}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={createReservationAfterOtp}
                      className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                    >
                      {submitting ? "Verifying…" : "Verify OTP"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast} onDismiss={dismissToast} />}
    </>
  );
}
