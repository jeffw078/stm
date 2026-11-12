-- The host is a single company. Codes identify assets across all its units.
-- A conflicting preexisting code stops the migration for explicit reconciliation.
CREATE UNIQUE INDEX IF NOT EXISTS pcm_assets_company_code_idx ON pcm.assets(lower(btrim(code)));
INSERT INTO pcm.schema_migrations(version) VALUES('040') ON CONFLICT DO NOTHING;
