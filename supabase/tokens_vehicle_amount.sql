-- Optional: add vehicle type and booking fee to tokens
ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS amount NUMERIC;
