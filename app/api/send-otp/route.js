import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  const { phone } = await request.json()

  // Validate Bangladesh phone number
  const cleanPhone = phone.replace(/\D/g, '')
  if (!/^01[3-9]\d{8}$/.test(cleanPhone)) {
    return NextResponse.json(
      { error: 'Invalid Bangladesh phone number' },
      { status: 400 }
    )
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

  // Store OTP in Supabase
  await supabase.from('otp_verifications').upsert({
    phone: cleanPhone,
    otp_code: otp,
    expires_at: expiresAt,
    verified: false
  }, { onConflict: 'phone' })

  // Send via GreenWeb BDBulkSMS
  const formData = new URLSearchParams()
  formData.append('token', process.env.GREENWEB_TOKEN)
  formData.append('to', '+88' + cleanPhone)
  formData.append('message', `Your FuelToken OTP is: ${otp}. Valid for 5 minutes. Do not share this code.`)

  const smsResponse = await fetch('https://api.bdbulksms.net/api.php', {
    method: 'POST',
    body: formData
  })

  const smsResult = await smsResponse.text()
  console.log('GreenWeb response:', smsResult)

  // GreenWeb returns a numeric message ID on success, or an error string
  if (isNaN(smsResult.trim())) {
    return NextResponse.json(
      { error: `SMS failed: ${smsResult}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, message: 'OTP sent to your phone' })
}