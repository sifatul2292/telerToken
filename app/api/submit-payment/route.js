import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  const {
    tokenId,
    paymentMethod,
    paymentNumber,
    transactionId
  } = await request.json()

  const { error } = await supabase
    .from('tokens')
    .update({
      payment_method: paymentMethod,
      payment_number: paymentNumber,
      transaction_id: transactionId,
      payment_submitted_at: new Date().toISOString(),
      status: 'pending_approval'
    })
    .eq('id', tokenId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}