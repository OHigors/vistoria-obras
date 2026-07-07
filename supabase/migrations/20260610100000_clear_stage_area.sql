-- Catalog stages no longer carry an area. Area is assigned per-apartment when a
-- step is added to a checklist (via the add-step popup). Clear the catalog value
-- for all existing stages. Apartment checklist_items keep their own area.
UPDATE service_stages SET area = '' WHERE area IS DISTINCT FROM '';
