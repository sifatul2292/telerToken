import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET() {
  const today = new Date().toISOString().split('T')[0]

  const { count } = await supabase
    .from('tokens')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today)

  return NextResponse.json({ 
    registeredToday: count || 0,
    message: count > 0 ? `${count} people registered today` : 'Be the first to register today'
  })
}