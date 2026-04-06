import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function sendSMS(phone, message) {
  const formData = new URLSearchParams()
  formData.append('token', process.env.GREENWEB_TOKEN)
  formData.append('to', '+88' + phone)
  formData.append('message', message)

  const response = await fetch('https://api.bdbulksms.net/api.php', {
    method: 'POST',
    body: formData
  })
  return response.text()
}

export async function POST(request) {
  const { tokenId, adminPassword } = await request.json()

  // Simple admin password check
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch full token details with relations
  const { data: token, error } = await supabase
    .from('tokens')
    .select(`
      *,
      citizens (full_name, phone),
      fuel_stations (name, address),
      time_slots (slot_date, start_time, end_time)
    `)
    .eq('id', tokenId)
    .single()

  if (error || !token) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }

  // Mark token as active + payment verified
  await supabase
    .from('tokens')
    .update({
      status: 'active',
      payment_verified: true
    })
    .eq('id', tokenId)

// Set 3-day lock ONLY when admin approves
await supabase
  .from('citizens')
  .update({ 
    locked_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString()
  })
  .eq('id', token.citizen_id)

  // Format slot date nicely
  const slotDate = new Date(token.time_slots.slot_date)
    .toLocaleDateString('en-BD', { weekday:'long', year:'numeric', month:'long', day:'numeric' })

  // Send confirmation SMS
  const message = 
    `FuelToken Confirmed!\n` +
    `Name: ${token.citizens.full_name}\n` +
    `Token: ${token.token_code}\n` +
    `Station: ${token.fuel_stations.name}\n` +
    `Address: ${token.fuel_stations.address}\n` +
    `Date: ${slotDate}\n` +
    `Time: ${token.time_slots.start_time} - ${token.time_slots.end_time}\n` +
    `Show your token code at the pump. Valid today only.`

  await sendSMS(token.citizens.phone, message)

  return NextResponse.json({ 
    success: true, 
    message: `Approved and SMS sent to ${token.citizens.phone}` 
  })
}