import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  const { phone, otp } = await request.json()

  const { data, error } = await supabase
    .from('otp_verifications')
    .select('*')
    .eq('phone', phone)
    .eq('otp_code', otp)
    .eq('verified', false)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: 'Invalid or expired OTP' },
      { status: 400 }
    )
  }

  // Mark OTP as used
  await supabase
    .from('otp_verifications')
    .update({ verified: true })
    .eq('phone', phone)

  return NextResponse.json({ success: true })
}