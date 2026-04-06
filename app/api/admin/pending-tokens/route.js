import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export async function POST(request) {
  const { adminPassword } = await request.json();

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: tokens, error } = await supabase
    .from("tokens")
    .select(
      `
      id,
      token_code,
      status,
      fuel_type,
      payment_method,
      payment_number,
      transaction_id,
      payment_submitted_at,
      amount,
      citizen_id,
      fuel_stations ( name ),
      time_slots ( slot_date, start_time, end_time ),
      citizens ( full_name, phone, driving_license_number )
    `,
    )
    .eq("status", "pending_approval")
    .order("payment_submitted_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tokens });
}
