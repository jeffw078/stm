CREATE TABLE IF NOT EXISTS pcm.import_batches (
 id text PRIMARY KEY, unit_id text NOT NULL REFERENCES sm5s.units(id), filename text NOT NULL,
 file_hash text NOT NULL, import_kind text NOT NULL, storage_key text NOT NULL,
 source_date date, mapping_version text NOT NULL, date_system text NOT NULL,
 sheets jsonb NOT NULL, warnings jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'REVIEW' CHECK(status IN ('REVIEW','PARTIAL','CONFIRMED')),
 revision integer NOT NULL DEFAULT 1, created_by text NOT NULL REFERENCES sm5s.users(id),
 confirmed_by text REFERENCES sm5s.users(id), confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(unit_id,import_kind,file_hash), UNIQUE(id,unit_id)
);
CREATE TABLE IF NOT EXISTS pcm.import_lines (
 id text PRIMARY KEY, batch_id text NOT NULL, unit_id text NOT NULL,
 sheet text NOT NULL, source_row integer NOT NULL CHECK(source_row BETWEEN 1 AND 1048576), kind text NOT NULL,
 raw jsonb NOT NULL, proposed_values jsonb NOT NULL, reviewed_values jsonb,
 issues jsonb NOT NULL DEFAULT '[]', proposed_action text NOT NULL, fingerprint text NOT NULL,
 status text NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 review_reason text, reviewed_by text REFERENCES sm5s.users(id), reviewed_at timestamptz,
 applied_at timestamptz, applied_entity_id text, revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY(batch_id,unit_id) REFERENCES pcm.import_batches(id,unit_id),
 UNIQUE(batch_id,sheet,source_row), UNIQUE(id,unit_id)
);
CREATE INDEX IF NOT EXISTS pcm_import_lines_batch ON pcm.import_lines(batch_id,status,source_row);
CREATE INDEX IF NOT EXISTS pcm_import_lines_fingerprint ON pcm.import_lines(unit_id,fingerprint);
CREATE TABLE IF NOT EXISTS pcm.stock_snapshots (
 id text PRIMARY KEY, unit_id text NOT NULL, import_line_id text NOT NULL UNIQUE,
 material_code text NOT NULL, establishment text, depot text, normalized_depot text, lot text, unit text NOT NULL,
 quantity numeric(20,6) NOT NULL, unit_cost numeric(20,6), source_value numeric(20,6), source_date date,
 FOREIGN KEY(import_line_id,unit_id) REFERENCES pcm.import_lines(id,unit_id)
);
CREATE INDEX IF NOT EXISTS pcm_stock_material_date ON pcm.stock_snapshots(unit_id,material_code,source_date);
CREATE TABLE IF NOT EXISTS pcm.imported_movements (
 id text PRIMARY KEY, unit_id text NOT NULL, import_line_id text NOT NULL UNIQUE,
 source_kind text NOT NULL CHECK(source_kind IN ('MOVEMENT','BAIXAS')),
 material_code text NOT NULL, quantity numeric(20,6), unit text,
 source_date date, establishment text, depot text, lot text, species text, movement_type text,
 document text, request_number text, cost_center text, source_value numeric(20,6),
 values jsonb NOT NULL, classification text NOT NULL DEFAULT 'UNMAPPED' CHECK(classification='UNMAPPED'),
 FOREIGN KEY(import_line_id,unit_id) REFERENCES pcm.import_lines(id,unit_id)
);
CREATE INDEX IF NOT EXISTS pcm_movements_material_date ON pcm.imported_movements(unit_id,material_code,source_date);
CREATE TABLE IF NOT EXISTS pcm.purchase_lines (
 id text PRIMARY KEY, unit_id text NOT NULL, import_line_id text NOT NULL UNIQUE,
 material_code text NOT NULL, purchase_order text, order_number text, quantity numeric(20,6), unit text,
 source_date date, source_status text, received_text text, received_quantity numeric(20,6), received_unit text,
 CHECK(received_quantity IS NULL OR (received_quantity>=0 AND received_unit IS NOT NULL AND (quantity IS NULL OR received_quantity<=quantity))),
 FOREIGN KEY(import_line_id,unit_id) REFERENCES pcm.import_lines(id,unit_id)
);
