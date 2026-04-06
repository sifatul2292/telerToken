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

  const { data: citizens, error } = await supabase
    .from('citizens')
    .select('id, full_name, phone, driving_license_number, locked_until, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get token counts per citizen
  const { data: tokenCounts } = await supabase
    .from('tokens')
    .select('citizen_id, status')

  const countMap = {}
  tokenCounts?.forEach(t => {
    countMap[t.citizen_id] = (countMap[t.citizen_id] || 0) + 1
  })

  const enriched = citizens.map(c => ({
    ...c,
    total_tokens: countMap[c.id] || 0
  }))

  return NextResponse.json({ citizens: enriched })
}