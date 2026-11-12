CREATE TABLE IF NOT EXISTS pcm.plans(
 id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),asset_id text NOT NULL REFERENCES pcm.assets(id),
 code text NOT NULL,name text NOT NULL,description text,active boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,
 created_by text REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(unit_id,code)
);
CREATE TABLE IF NOT EXISTS pcm.plan_versions(
 id text PRIMARY KEY,plan_id text NOT NULL REFERENCES pcm.plans(id),version integer NOT NULL,snapshot jsonb NOT NULL,
 effective_from date NOT NULL,effective_to date,next_index integer NOT NULL DEFAULT 0 CHECK(next_index>=0),last_run_at timestamptz,
 created_by text REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(plan_id,version)
);
CREATE TABLE IF NOT EXISTS pcm.occurrences(
 id text PRIMARY KEY,plan_id text NOT NULL REFERENCES pcm.plans(id),plan_version_id text NOT NULL REFERENCES pcm.plan_versions(id),unit_id text NOT NULL REFERENCES sm5s.units(id),asset_id text NOT NULL REFERENCES pcm.assets(id),
 original_due_date date NOT NULL,scheduled_date date NOT NULL,original_deadline date NOT NULL,order_id text UNIQUE REFERENCES pcm.orders(id),revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(plan_id,asset_id,original_due_date)
);
CREATE INDEX IF NOT EXISTS pcm_occurrence_schedule_idx ON pcm.occurrences(unit_id,scheduled_date);
CREATE TABLE IF NOT EXISTS pcm.job_runs(
 id text PRIMARY KEY,actor_id text REFERENCES sm5s.users(id),as_of timestamptz NOT NULL,status text NOT NULL CHECK(status IN('RUNNING','SUCCEEDED','FAILED')),
 started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,generated integer NOT NULL DEFAULT 0,scanned integer NOT NULL DEFAULT 0,limited boolean NOT NULL DEFAULT false,error_code text
);
CREATE TABLE IF NOT EXISTS pcm.failures(
 id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),asset_id text NOT NULL REFERENCES pcm.assets(id),started_at timestamptz NOT NULL,ended_at timestamptz,
 functional_loss boolean NOT NULL,description text NOT NULL,revision integer NOT NULL DEFAULT 1,created_by text REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ended_at IS NULL OR ended_at>started_at)
);
CREATE INDEX IF NOT EXISTS pcm_failure_asset_idx ON pcm.failures(asset_id,started_at);
CREATE TABLE IF NOT EXISTS pcm.repair_intervals(id text PRIMARY KEY,failure_id text NOT NULL REFERENCES pcm.failures(id),started_at timestamptz NOT NULL,ended_at timestamptz NOT NULL,CHECK(ended_at>started_at));
CREATE TABLE IF NOT EXISTS pcm.downtime_intervals(id text PRIMARY KEY,failure_id text NOT NULL REFERENCES pcm.failures(id),started_at timestamptz NOT NULL,ended_at timestamptz,planned boolean NOT NULL,CHECK(ended_at IS NULL OR ended_at>started_at));
CREATE TABLE IF NOT EXISTS pcm.operational_calendars(
 id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),asset_id text REFERENCES pcm.assets(id),name text NOT NULL,weekly_windows jsonb NOT NULL,valid_from date NOT NULL,valid_to date,
 created_by text REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(valid_to IS NULL OR valid_to>=valid_from)
);
CREATE TABLE IF NOT EXISTS pcm.exposures(
 id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),asset_id text NOT NULL REFERENCES pcm.assets(id),started_at timestamptz NOT NULL,ended_at timestamptz NOT NULL,
 operating_hours numeric(16,4) NOT NULL CHECK(operating_hours>=0),source text NOT NULL,created_by text REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(ended_at>started_at),CHECK(operating_hours<=EXTRACT(EPOCH FROM(ended_at-started_at))/3600)
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pcm_orders_failure_fk' AND conrelid='pcm.orders'::regclass) THEN ALTER TABLE pcm.orders ADD CONSTRAINT pcm_orders_failure_fk FOREIGN KEY(failure_id) REFERENCES pcm.failures(id); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pcm_orders_plan_version_fk' AND conrelid='pcm.orders'::regclass) THEN ALTER TABLE pcm.orders ADD CONSTRAINT pcm_orders_plan_version_fk FOREIGN KEY(plan_version_id) REFERENCES pcm.plan_versions(id); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pcm_orders_occurrence_fk' AND conrelid='pcm.orders'::regclass) THEN ALTER TABLE pcm.orders ADD CONSTRAINT pcm_orders_occurrence_fk FOREIGN KEY(occurrence_id) REFERENCES pcm.occurrences(id); END IF;
END $$;
INSERT INTO pcm.schema_migrations(version) VALUES('020') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION pcm.planning_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pcm.assets WHERE id=NEW.asset_id AND unit_id=NEW.unit_id) THEN RAISE EXCEPTION 'Planning asset unit mismatch'; END IF;
 IF TG_TABLE_NAME='occurrences' THEN
  IF NOT EXISTS(SELECT 1 FROM pcm.plans WHERE id=NEW.plan_id AND unit_id=NEW.unit_id AND asset_id=NEW.asset_id) OR NOT EXISTS(SELECT 1 FROM pcm.plan_versions WHERE id=NEW.plan_version_id AND plan_id=NEW.plan_id) THEN RAISE EXCEPTION 'Occurrence plan mismatch'; END IF;
  IF NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pcm.orders WHERE id=NEW.order_id AND unit_id=NEW.unit_id AND asset_id=NEW.asset_id AND occurrence_id=NEW.id AND plan_version_id=NEW.plan_version_id) THEN RAISE EXCEPTION 'Occurrence order mismatch'; END IF;
  IF TG_OP='UPDATE' AND (NEW.original_due_date<>OLD.original_due_date OR NEW.original_deadline<>OLD.original_deadline OR NEW.plan_id<>OLD.plan_id OR NEW.plan_version_id<>OLD.plan_version_id OR NEW.asset_id<>OLD.asset_id OR NEW.unit_id<>OLD.unit_id) THEN RAISE EXCEPTION 'Original occurrence is immutable'; END IF;
 END IF;
 IF TG_TABLE_NAME IN('failures','plans') AND TG_OP='UPDATE' AND (NEW.unit_id<>OLD.unit_id OR NEW.asset_id<>OLD.asset_id) THEN RAISE EXCEPTION 'Historical planning target is immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pcm_plans_integrity ON pcm.plans;
CREATE TRIGGER pcm_plans_integrity BEFORE INSERT OR UPDATE ON pcm.plans FOR EACH ROW EXECUTE FUNCTION pcm.planning_integrity();
DROP TRIGGER IF EXISTS pcm_occurrences_integrity ON pcm.occurrences;
CREATE TRIGGER pcm_occurrences_integrity BEFORE INSERT OR UPDATE ON pcm.occurrences FOR EACH ROW EXECUTE FUNCTION pcm.planning_integrity();
DROP TRIGGER IF EXISTS pcm_failures_integrity ON pcm.failures;
CREATE TRIGGER pcm_failures_integrity BEFORE INSERT OR UPDATE ON pcm.failures FOR EACH ROW EXECUTE FUNCTION pcm.planning_integrity();
DROP TRIGGER IF EXISTS pcm_calendars_integrity ON pcm.operational_calendars;
CREATE TRIGGER pcm_calendars_integrity BEFORE INSERT OR UPDATE ON pcm.operational_calendars FOR EACH ROW EXECUTE FUNCTION pcm.planning_integrity();
DROP TRIGGER IF EXISTS pcm_exposures_integrity ON pcm.exposures;
CREATE TRIGGER pcm_exposures_integrity BEFORE INSERT OR UPDATE ON pcm.exposures FOR EACH ROW EXECUTE FUNCTION pcm.planning_integrity();
CREATE OR REPLACE FUNCTION pcm.plan_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.plan_id<>OLD.plan_id OR NEW.version<>OLD.version OR NEW.effective_from<>OLD.effective_from THEN RAISE EXCEPTION 'Plan version snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pcm_version_immutable ON pcm.plan_versions;
CREATE TRIGGER pcm_version_immutable BEFORE UPDATE ON pcm.plan_versions FOR EACH ROW EXECUTE FUNCTION pcm.plan_version_immutable();

CREATE OR REPLACE FUNCTION pcm.planning_order_integrity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.failure_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pcm.failures WHERE id=NEW.failure_id AND unit_id=NEW.unit_id AND asset_id=NEW.asset_id) THEN RAISE EXCEPTION 'Order failure target mismatch'; END IF;
 IF NEW.plan_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pcm.plan_versions v JOIN pcm.plans p ON p.id=v.plan_id WHERE v.id=NEW.plan_version_id AND p.unit_id=NEW.unit_id AND p.asset_id=NEW.asset_id) THEN RAISE EXCEPTION 'Order plan target mismatch'; END IF;
 IF NEW.occurrence_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pcm.occurrences WHERE id=NEW.occurrence_id AND unit_id=NEW.unit_id AND asset_id=NEW.asset_id AND plan_version_id=NEW.plan_version_id AND (order_id IS NULL OR order_id=NEW.id)) THEN RAISE EXCEPTION 'Order occurrence target mismatch'; END IF;
 IF TG_OP='UPDATE' AND OLD.occurrence_id IS NOT NULL AND(NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id OR NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.unit_id<>OLD.unit_id) THEN RAISE EXCEPTION 'Generated order origin is immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pcm_order_planning_integrity ON pcm.orders;
CREATE TRIGGER pcm_order_planning_integrity BEFORE INSERT OR UPDATE ON pcm.orders FOR EACH ROW EXECUTE FUNCTION pcm.planning_order_integrity();
