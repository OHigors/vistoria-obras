-- Security hardening (2026-06-09)
-- 1. emergency column on checklist_items (pending from the Emergência feature)
-- 2. Soft deletes: deleted_at on checklist_items, inspection_photos, measurements
-- 3. Audit log: trigger-based, captures UPDATE/DELETE on the main tables
-- 4. Storage: make inspection-photos private + size/MIME limits
--
-- Idempotent: safe to run more than once.

-- ── 1. Emergency column ───────────────────────────────────────────────────────

ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS emergency text DEFAULT '';

-- ── 2. Soft deletes ───────────────────────────────────────────────────────────

ALTER TABLE checklist_items   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE measurements      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── 3. Audit log ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id  text,
  operation  text NOT NULL,
  old_data   jsonb,
  new_data   jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid DEFAULT auth.uid()
);

-- RLS enabled with NO policies: the table is invisible to the API (anon and
-- authenticated). Only the SECURITY DEFINER trigger below writes to it, and
-- reads happen via the Supabase dashboard / SQL editor.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (table_name, record_id, operation, old_data)
    VALUES (TG_TABLE_NAME, (OLD.id)::text, TG_OP, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  INSERT INTO audit_log (table_name, record_id, operation, old_data, new_data)
  VALUES (TG_TABLE_NAME, (NEW.id)::text, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'apartments',
    'checklist_items',
    'inspection_visits',
    'inspection_photos',
    'measurements',
    'service_stages'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn()',
      t, t
    );
  END LOOP;
END;
$$;

-- ── 4. Storage hardening ──────────────────────────────────────────────────────

-- Private bucket: public URLs stop working; the app now uses signed URLs.
-- 10 MB limit and image-only MIME types enforced server-side.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'inspection-photos';
