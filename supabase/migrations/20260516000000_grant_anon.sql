-- Grant table-level DML access to the anon role so the app can query
-- without requiring Supabase Auth. Policies are updated to cover both
-- anon and authenticated roles.

GRANT SELECT, INSERT, UPDATE, DELETE ON obras             TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON towers            TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON apartments        TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_items   TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_stages    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_visits TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_photos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON measurements      TO anon;

DROP POLICY IF EXISTS authenticated_all ON obras;
DROP POLICY IF EXISTS authenticated_all ON towers;
DROP POLICY IF EXISTS authenticated_all ON apartments;
DROP POLICY IF EXISTS authenticated_all ON checklist_items;
DROP POLICY IF EXISTS authenticated_all ON service_stages;
DROP POLICY IF EXISTS authenticated_all ON inspection_visits;
DROP POLICY IF EXISTS authenticated_all ON inspection_photos;
DROP POLICY IF EXISTS authenticated_all ON measurements;

CREATE POLICY anon_all ON obras             FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON towers            FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON apartments        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON checklist_items   FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON service_stages    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON inspection_visits FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON inspection_photos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON measurements      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
