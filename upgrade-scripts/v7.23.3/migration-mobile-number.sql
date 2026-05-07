-- ============================================
-- kykie.net v7.23.3 — Add mobile_number to profiles
-- ============================================
-- Adds an optional mobile number field, captured at registration
-- and editable by admins from User Management.
-- Run in Supabase SQL editor (production AND staging).

-- 1. Column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mobile_number TEXT;

-- 2. Update register_crowd_profile RPC to accept the new field
CREATE OR REPLACE FUNCTION register_crowd_profile(
  p_id UUID,
  p_email TEXT,
  p_firstname TEXT,
  p_lastname TEXT,
  p_username TEXT,
  p_role TEXT DEFAULT 'supporter',
  p_alias_nickname TEXT DEFAULT NULL,
  p_date_of_birth DATE DEFAULT NULL,
  p_biological_gender TEXT DEFAULT NULL,
  p_home_town TEXT DEFAULT NULL,
  p_sport_interest TEXT[] DEFAULT '{}',
  p_supporting_institution_ids UUID[] DEFAULT '{}',
  p_notify_live BOOLEAN DEFAULT true,
  p_notify_rewards BOOLEAN DEFAULT true,
  p_notify_general BOOLEAN DEFAULT true,
  p_accepted_terms_at TIMESTAMPTZ DEFAULT NULL,
  p_mobile_number TEXT DEFAULT NULL
)
RETURNS void AS $fn$
BEGIN
  INSERT INTO public.profiles (
    id, email, firstname, lastname, username, role, roles,
    alias_nickname, date_of_birth, biological_gender, home_town,
    sport_interest, supporting_institution_ids, commentator_status, coach_status,
    notify_live, notify_rewards, notify_general, accepted_terms_at, mobile_number
  ) VALUES (
    p_id, p_email, p_firstname, p_lastname, p_username,
    p_role, ARRAY[p_role],
    p_alias_nickname, p_date_of_birth, p_biological_gender, p_home_town,
    p_sport_interest, p_supporting_institution_ids,
    CASE WHEN p_role = 'commentator' THEN 'trainee' ELSE NULL END,
    CASE WHEN p_role = 'coach' THEN 'pending' ELSE NULL END,
    p_notify_live, p_notify_rewards, p_notify_general, p_accepted_terms_at,
    p_mobile_number
  );
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
