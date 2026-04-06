import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export async function POST(request) {
  const { adminPassword, tab = "all", search = "" } = await request.json();

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let query = supabase
    .from("tokens")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (tab === "pending") {
    query = query.in("status", ["pending_payment", "pending_approval"]);
  } else if (tab === "active") {
    query = query.eq("status", "active");
  } else if (tab === "used") {
    query = query.eq("status", "used");
  } else if (tab === "rejected") {
    query = query.eq("status", "rejected");
  }

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let list = rows ?? [];
  const s = String(search).trim().toLowerCase();
  if (s) {
    list = list.filter((row) => {
      const name = (row.citizen_name ?? "").toLowerCase();
      const phone = (row.citizen_phone ?? "").toLowerCase();
      const trx = (row.transaction_id ?? "").toLowerCase();
      const code = (row.token_code ?? "").toLowerCase();
      return (
        name.includes(s) ||
        phone.includes(s) ||
        trx.includes(s) ||
        code.includes(s)
      );
    });
  }

  return NextResponse.json({ tokens: list });
}
