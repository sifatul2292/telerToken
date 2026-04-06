-- Run after booking_schema.sql if these columns are missing.

ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS token_code TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_payment',
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_number TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_verified BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS tokens_token_code_key ON public.tokens (token_code) WHERE token_code IS NOT NULL;

DROP POLICY IF EXISTS "tokens_update_anon" ON public.tokens;
CREATE POLICY "tokens_update_anon" ON public.tokens FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Used when admin rejects a booking (see app/api/admin/reject-token/route.js)
CREATE OR REPLACE FUNCTION public.decrement_slot(slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.time_slots
  SET
    booked_count = GREATEST(0, COALESCE(booked_count, 0) - 1),
    is_booked = false
  WHERE id = slot_id;
END;
$$;
