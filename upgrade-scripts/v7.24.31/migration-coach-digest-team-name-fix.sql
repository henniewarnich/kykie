-- v7.24.31 — Coach digest: drop legacy teams.name fallback
-- The teams.name column was removed when team display became institution-derived.
-- notify_coach_digest still referenced ht.name / at.name, causing every send
-- to fail with: "column ht.name does not exist". This rewrites the SELECT to
-- use only the institution columns (short_name / name) for the digest header.
-- Run in Supabase SQL editor (production + staging).

CREATE OR REPLACE FUNCTION notify_coach_digest(
  p_coach_id      UUID,
  p_report_ids    UUID[],
  p_override_email TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_coach     RECORD;
  v_report    RECORD;
  v_html      TEXT;
  v_subject   TEXT;
  v_count     INT := 0;
  v_log_id    UUID;
  v_send_to   TEXT;
  v_test_mode BOOLEAN := p_override_email IS NOT NULL;
  v_score_line TEXT;
  v_pen_line  TEXT;
BEGIN
  IF p_report_ids IS NULL OR array_length(p_report_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'No reports specified');
  END IF;

  SELECT id, firstname, email, coach_status
  INTO v_coach
  FROM profiles
  WHERE id = p_coach_id;

  IF NOT FOUND OR v_coach.email IS NULL THEN
    RETURN jsonb_build_object('error', 'Coach not found or has no email');
  END IF;

  IF v_coach.coach_status = 'pending' AND NOT v_test_mode THEN
    RETURN jsonb_build_object('error', 'Coach is pending — not notifying', 'recipient', v_coach.email);
  END IF;

  v_send_to := COALESCE(p_override_email, v_coach.email);

  v_html := '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0B0F1A;color:#E2E8F0;padding:24px;border-radius:12px">'
    || '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #1E293B;margin-bottom:20px">'
    || '<tr>'
    || '<td style="padding-bottom:14px;text-align:left;vertical-align:middle">'
    || '<img src="https://kykie.net/kykie-logo-light.png" alt="kykie" height="24" style="height:24px;width:auto;display:inline-block">'
    || '</td>'
    || '<td style="padding-bottom:14px;text-align:right;vertical-align:middle;font-size:10px;font-weight:700;color:#64748B;letter-spacing:2px">'
    || 'MATCH REPORTS'
    || '</td>'
    || '</tr>'
    || '</table>'
    || '<div style="font-size:14px;color:#F8FAFC;margin-bottom:12px">Hi ' || COALESCE(v_coach.firstname, 'Coach') || ',</div>'
    || '<div style="font-size:13px;color:#94A3B8;margin-bottom:18px;line-height:1.5">New match analysis is available for the following matches:</div>';

  FOR v_report IN
    SELECT mr.id, mr.match_id,
           m.match_date, m.home_score, m.away_score,
           m.home_penalty_score, m.away_penalty_score,
           COALESCE(hi.short_name, hi.name, 'Home') AS home_name,
           COALESCE(ai.short_name, ai.name, 'Away') AS away_name
    FROM match_reports mr
    JOIN matches m       ON m.id = mr.match_id
    JOIN teams ht        ON ht.id = m.home_team_id
    JOIN teams at        ON at.id = m.away_team_id
    LEFT JOIN institutions hi ON hi.id = ht.institution_id
    LEFT JOIN institutions ai ON ai.id = at.institution_id
    WHERE mr.id = ANY(p_report_ids)
    ORDER BY m.match_date DESC
  LOOP
    v_score_line := v_report.home_name || ' ' || v_report.home_score || ' – ' || v_report.away_score || ' ' || v_report.away_name;

    IF v_report.home_penalty_score IS NOT NULL AND v_report.away_penalty_score IS NOT NULL THEN
      IF v_report.home_penalty_score > v_report.away_penalty_score THEN
        v_pen_line := '<div style="font-size:12px;color:#F59E0B;font-weight:700;margin-bottom:10px">'
          || v_report.home_name || ' won ' || v_report.home_penalty_score || '–' || v_report.away_penalty_score || ' on penalties'
          || '</div>';
      ELSE
        v_pen_line := '<div style="font-size:12px;color:#F59E0B;font-weight:700;margin-bottom:10px">'
          || v_report.away_name || ' won ' || v_report.away_penalty_score || '–' || v_report.home_penalty_score || ' on penalties'
          || '</div>';
      END IF;
    ELSE
      v_pen_line := '';
    END IF;

    v_html := v_html
      || '<div style="background:#1E293B;border-radius:10px;padding:14px;border:1px solid #334155;margin-bottom:10px">'
      || '<div style="font-size:10px;color:#64748B;margin-bottom:6px">' || COALESCE(v_report.match_date::TEXT, '') || '</div>'
      || '<div style="font-size:15px;font-weight:800;color:#F8FAFC;margin-bottom:' || CASE WHEN v_pen_line = '' THEN '10px' ELSE '4px' END || '">'
      || v_score_line
      || '</div>'
      || v_pen_line
      || '<a href="https://kykie.net/#/report/' || v_report.id || '" style="display:inline-block;padding:8px 16px;background:#10B981;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;font-size:11px">View Report →</a>'
      || '</div>';
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('error', 'No matching reports found');
  END IF;

  v_html := v_html
    || '<div style="text-align:center;margin-top:18px;font-size:10px;color:#334155">You received this because you are a registered coach on kykie.net</div>'
    || '</div>';

  v_subject := CASE WHEN v_test_mode THEN '[TEST] ' ELSE '' END
    || v_count || ' new match report' || CASE WHEN v_count > 1 THEN 's' ELSE '' END
    || CASE WHEN v_test_mode THEN ' (intended for ' || v_coach.email || ')' ELSE ' from kykie' END;

  PERFORM send_email(v_send_to, v_subject, v_html);

  IF v_test_mode THEN
    RETURN jsonb_build_object('sent', v_count, 'recipient', v_send_to, 'test', true, 'intended_for', v_coach.email);
  END IF;

  INSERT INTO communication_log (comm_type, recipient_id, recipient_email, subject, related_ids, sent_by, status)
  VALUES (
    'report_digest',
    v_coach.id,
    v_coach.email,
    v_subject,
    jsonb_build_object('report_ids', to_jsonb(p_report_ids)),
    auth.uid(),
    'sent'
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('sent', v_count, 'log_id', v_log_id, 'recipient', v_coach.email);
END;
$fn$;
