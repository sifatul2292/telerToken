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
  await fetch('https://api.bdbulksms.net/api.php', { method:'POST', body:formData })
}

export async function POST(request) {
  const { tokenId, adminPassword, reason } = await request.json()

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: token, error: tokenErr } = await supabase
    .from('tokens')
    .select('*, citizens(full_name, phone), time_slots(slot_date)')
    .eq('id', tokenId)
    .single()

  if (tokenErr || !token) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }

  // Mark rejected + unlock citizen so they can try again
  await supabase
    .from('tokens')
    .update({ status: 'rejected' })
    .eq('id', tokenId)

  await supabase
    .from('citizens')
    .update({ locked_until: null })
    .eq('id', token.citizen_id)

  // Reset the slot count
  const slotId = token.time_slot_id ?? token.slot_id
  if (slotId) {
    await supabase.rpc('decrement_slot', { slot_id: slotId })
  }

  const message =
    `FuelToken Update: Your payment could not be verified.\n` +
    `Reason: ${reason || 'Transaction ID not found'}\n` +
    `Your slot has been released. Please try booking again with correct payment details.\n` +
    `Helpline: ${process.env.HELPLINE_NUMBER || '01XXXXXXXXX'}`

  await sendSMS(token.citizens.phone, message)

  return NextResponse.json({ success: true, message: 'Token rejected, citizen unlocked, SMS sent.' })
}