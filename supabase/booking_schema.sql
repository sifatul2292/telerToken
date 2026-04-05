-- Run in Supabase SQL editor (adjust if tables already exist).
-- Requires public.fuel_stations and public.time_slots from your project.

CREATE TABLE IF NOT EXISTS public.citizens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  driving_license_number TEXT NOT NULL UNIQUE,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id UUID NOT NULL REFERENCES public.citizens (id) ON DELETE CASCADE,
  station_id UUID NOT NULL REFERENCES public.fuel_stations (id) ON DELETE CASCADE,
  time_slot_id UUID NOT NULL REFERENCES public.time_slots (id) ON DELETE CASCADE,
  fuel_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_citizens_phone ON public.citizens (phone);
CREATE INDEX IF NOT EXISTS idx_citizens_license ON public.citizens (driving_license_number);
CREATE INDEX IF NOT EXISTS idx_citizens_locked_until ON public.citizens (locked_until);
CREATE INDEX IF NOT EXISTS idx_tokens_citizen ON public.tokens (citizen_id);
CREATE INDEX IF NOT EXISTS idx_tokens_slot ON public.tokens (time_slot_id);

ALTER TABLE public.citizens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;

-- Development-friendly policies for the anon key (tighten for production).
CREATE POLICY "citizens_select_anon" ON public.citizens FOR SELECT TO anon USING (true);
CREATE POLICY "citizens_insert_anon" ON public.citizens FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "citizens_update_anon" ON public.citizens FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "tokens_select_anon" ON public.tokens FOR SELECT TO anon USING (true);
CREATE POLICY "tokens_insert_anon" ON public.tokens FOR INSERT TO anon WITH CHECK (true);

-- time_slots: allow reads/updates from the client for booking (skip if you already manage RLS).
ALTER TABLE public.time_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_slots_select_anon" ON public.time_slots FOR SELECT TO anon USING (true);
CREATE POLICY "time_slots_update_anon" ON public.time_slots FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- If fuel_stations lost public read after other changes, add:
-- CREATE POLICY "fuel_stations_select_anon" ON public.fuel_stations FOR SELECT TO anon USING (true);
