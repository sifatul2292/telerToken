import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  const { adminPassword, status } = await request.json()

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let query = supabase
    .from('tokens')
    .select(`
      id, token_code, status, fuel_type,
      citizen_name, citizen_phone,
      payment_method, payment_number,
      transaction_id, payment_submitted_at,
      payment_verified, amount, created_at,
      fuel_stations ( name, address ),
      time_slots ( slot_date, start_time, end_time )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data: tokens, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tokens })
}