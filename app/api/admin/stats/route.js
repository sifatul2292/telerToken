import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

function todayYmdDhaka() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dhakaDayBoundsIso() {
  const ymd = todayYmdDhaka();
  const start = new Date(`${ymd}T00:00:00+06:00`);
  const end = new Date(`${ymd}T23:59:59.999+06:00`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function POST(request) {
  const { adminPassword } = await request.json();

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { startIso, endIso } = dhakaDayBoundsIso();
  const slotDate = todayYmdDhaka();

  const { count: pendingTotal, error: e1 } = await supabase
    .from("tokens")
    .select("*", { count: "exact", head: true })
    .in("status", ["pending_payment", "pending_approval"]);

  if (e1) {
    return NextResponse.json({ error: e1.message }, { status: 500 });
  }

  const { data: activeRows, error: e2 } = await supabase
    .from("tokens")
    .select("id, time_slots ( slot_date )")
    .eq("status", "active");

  if (e2) {
    return NextResponse.json({ error: e2.message }, { status: 500 });
  }

  const activeToday = (activeRows ?? []).filter(
    (row) => row.time_slots?.slot_date === slotDate,
  ).length;

  const { count: usedToday, error: e3 } = await supabase
    .from("tokens")
    .select("*", { count: "exact", head: true })
    .eq("status", "used")
    .gte("updated_at", startIso)
    .lte("updated_at", endIso);

  if (e3) {
    return NextResponse.json({ error: e3.message }, { status: 500 });
  }

  const { count: rejectedTotal, error: e4 } = await supabase
    .from("tokens")
    .select("*", { count: "exact", head: true })
    .eq("status", "rejected");

  if (e4) {
    return NextResponse.json({ error: e4.message }, { status: 500 });
  }

  return NextResponse.json({
    pendingTotal: pendingTotal ?? 0,
    activeToday,
    usedToday: usedToday ?? 0,
    rejectedTotal: rejectedTotal ?? 0,
  });
}
