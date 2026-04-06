import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  const { adminPassword } = await request.json()

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0]

  const { data: tokens } = await supabase
    .from('tokens')
    .select('status, created_at')

  const pendingTotal = tokens?.filter(t =>
    t.status === 'pending_approval' || t.status === 'pending_payment'
  ).length ?? 0

  const activeToday = tokens?.filter(t =>
    t.status === 'active' &&
    t.created_at?.startsWith(today)
  ).length ?? 0

  const usedToday = tokens?.filter(t =>
    t.status === 'used' &&
    t.created_at?.startsWith(today)
  ).length ?? 0

  const rejectedTotal = tokens?.filter(t =>
    t.status === 'rejected'
  ).length ?? 0

  return NextResponse.json({
    pendingTotal,
    activeToday,
    usedToday,
    rejectedTotal
  })
}