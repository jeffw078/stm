CREATE TABLE IF NOT EXISTS pcm.assets (
 id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),sector_id text REFERENCES sm5s.sectors(id),parent_id text,
 code text NOT NULL CHECK(length(trim(code))>0),name text NOT NULL,description text,
 node_type text NOT NULL CHECK(node_type IN ('MACHINE','SYSTEM','ASSEMBLY','COMPONENT','ITEM')),
 location text,cost_center text,manufacturer text,model text,serial_number text,patrimony text,material_code text,category text,
 acquired_on date,installed_on date,lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle IN ('ACTIVE','MAINTENANCE','RESERVE','INACTIVE')),
 criticality text NOT NULL DEFAULT 'MEDIUM' CHECK(criticality IN ('HIGH','MEDIUM','LOW')),criticality_reason text,team_id text,notes text,
 revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,unit_id),FOREIGN KEY(parent_id,unit_id) REFERENCES pcm.assets(id,unit_id),FOREIGN KEY(team_id,unit_id) REFERENCES pcm.teams(id,unit_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pcm_assets_code_idx ON pcm.assets(unit_id,lower(code));
CREATE INDEX IF NOT EXISTS pcm_assets_parent_idx ON pcm.assets(parent_id);
CREATE OR REPLACE FUNCTION pcm.lock_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM id FROM pcm.integrity_lock WHERE id=1 FOR UPDATE; RETURN NULL; END $$;
CREATE TRIGGER pcm_assets_lock BEFORE INSERT OR UPDATE OR DELETE ON pcm.assets FOR EACH STATEMENT EXECUTE FUNCTION pcm.lock_integrity();
CREATE OR REPLACE FUNCTION pcm.asset_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.unit_id<>OLD.unit_id THEN RAISE EXCEPTION 'Asset unit is immutable'; END IF;
 IF NEW.sector_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sm5s.sectors WHERE id=NEW.sector_id AND unit_id=NEW.unit_id) THEN RAISE EXCEPTION 'Sector unit mismatch'; END IF;
 IF NEW.parent_id IS NOT NULL AND (NEW.parent_id=NEW.id OR EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM pcm.assets WHERE id=NEW.parent_id UNION SELECT a.id,a.parent_id FROM pcm.assets a JOIN ancestors p ON a.id=p.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id)) THEN RAISE EXCEPTION 'Asset cycle'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pcm_assets_integrity BEFORE INSERT OR UPDATE ON pcm.assets FOR EACH ROW EXECUTE FUNCTION pcm.asset_integrity();
CREATE TABLE IF NOT EXISTS pcm.asset_history(id text PRIMARY KEY,asset_id text NOT NULL REFERENCES pcm.assets(id),unit_id text NOT NULL REFERENCES sm5s.units(id),action text NOT NULL,effective_date date NOT NULL,reason text,old_snapshot jsonb,new_snapshot jsonb NOT NULL,actor_id text REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pcm_asset_history_idx ON pcm.asset_history(asset_id,created_at);

CREATE TABLE IF NOT EXISTS pcm.orders (
 id text PRIMARY KEY,number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,unit_id text NOT NULL REFERENCES sm5s.units(id),asset_id text,location text,
 description text NOT NULL,type text NOT NULL DEFAULT 'CORRECTIVE' CHECK(type IN ('CORRECTIVE','PREVENTIVE','INSPECTION')),
 priority text NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),
 status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','SCHEDULED','IN_PROGRESS','WAITING','EXECUTED','CLOSED','CANCELLED')),
 assignee_id text REFERENCES sm5s.users(id),team_id text,planned_start timestamptz,due_at timestamptz,estimated_hours numeric(20,6) CHECK(estimated_hours>=0),estimated_person_hours numeric(20,6) CHECK(estimated_person_hours>=0),
 failure_id text,requires_asset boolean NOT NULL DEFAULT false,checklist jsonb NOT NULL DEFAULT '[]',plan_version_id text,occurrence_id text UNIQUE,
 asset_snapshot jsonb NOT NULL,summary text,result text,final_condition text,diagnosis text,cause text,cause_unknown_reason text,action_taken text,recommendation text,
 created_by text REFERENCES sm5s.users(id),revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),executed_at timestamptz,closed_at timestamptz,
 UNIQUE(id,unit_id),FOREIGN KEY(asset_id,unit_id) REFERENCES pcm.assets(id,unit_id),FOREIGN KEY(team_id,unit_id) REFERENCES pcm.teams(id,unit_id),CHECK(asset_id IS NOT NULL OR length(trim(COALESCE(location,'')))>0)
);
CREATE INDEX IF NOT EXISTS pcm_orders_scope_idx ON pcm.orders(unit_id,status,due_at);
CREATE INDEX IF NOT EXISTS pcm_orders_asset_idx ON pcm.orders(asset_id,created_at);
CREATE INDEX IF NOT EXISTS pcm_orders_assignee_idx ON pcm.orders(assignee_id,team_id);
CREATE INDEX IF NOT EXISTS pcm_orders_path_idx ON pcm.orders USING gin(asset_snapshot);
CREATE TABLE IF NOT EXISTS pcm.order_status_history(id text PRIMARY KEY,order_id text NOT NULL REFERENCES pcm.orders(id),from_status text,to_status text NOT NULL,reason text,actor_id text REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pcm_order_status_idx ON pcm.order_status_history(order_id,created_at);
CREATE TABLE IF NOT EXISTS pcm.requests(
 id text PRIMARY KEY,number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,unit_id text NOT NULL REFERENCES sm5s.units(id),sector_id text REFERENCES sm5s.sectors(id),asset_id text,location text,description text NOT NULL,impact text,stopped boolean,
 priority text NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),status text NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','TRIAGED','CONVERTED','LINKED','REJECTED','CANCELLED')),
 requester_id text NOT NULL REFERENCES sm5s.users(id),order_id text,reason text,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,unit_id),FOREIGN KEY(asset_id,unit_id) REFERENCES pcm.assets(id,unit_id),FOREIGN KEY(order_id,unit_id) REFERENCES pcm.orders(id,unit_id),CHECK(asset_id IS NOT NULL OR length(trim(COALESCE(location,'')))>0)
);
CREATE INDEX IF NOT EXISTS pcm_requests_scope_idx ON pcm.requests(unit_id,requester_id,status,created_at);
CREATE TABLE IF NOT EXISTS pcm.comments(id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),request_id text,order_id text,body text NOT NULL,internal boolean NOT NULL DEFAULT false,actor_id text NOT NULL REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(num_nonnulls(request_id,order_id)=1),FOREIGN KEY(request_id,unit_id) REFERENCES pcm.requests(id,unit_id),FOREIGN KEY(order_id,unit_id) REFERENCES pcm.orders(id,unit_id));
CREATE TABLE IF NOT EXISTS pcm.work_sessions(id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),order_id text NOT NULL,user_id text NOT NULL REFERENCES sm5s.users(id),started_at timestamptz NOT NULL,ended_at timestamptz,hours numeric(20,6),hourly_rate numeric(20,6) CHECK(hourly_rate>=0),cost numeric(20,6),idempotency_key text,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(order_id,user_id,idempotency_key),FOREIGN KEY(order_id,unit_id) REFERENCES pcm.orders(id,unit_id),CHECK(ended_at IS NULL OR ended_at>started_at));
CREATE UNIQUE INDEX IF NOT EXISTS pcm_work_open_idx ON pcm.work_sessions(user_id) WHERE ended_at IS NULL;
ALTER TABLE pcm.work_sessions ADD COLUMN stop_idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS pcm_work_stop_idempotency_idx ON pcm.work_sessions(order_id,user_id,stop_idempotency_key);
CREATE INDEX IF NOT EXISTS pcm_work_order_idx ON pcm.work_sessions(order_id);
CREATE TABLE IF NOT EXISTS pcm.materials(id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),code text NOT NULL,name text NOT NULL,description text,manufacturer text,manufacturer_reference text,supplier text,unit text NOT NULL,minimum_quantity numeric(20,6) CHECK(minimum_quantity>=0),safety_stock numeric(20,6) CHECK(safety_stock>=0),unit_cost numeric(20,6) CHECK(unit_cost>=0),notes text,active boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,unit_id),UNIQUE(unit_id,code));
CREATE UNIQUE INDEX IF NOT EXISTS pcm_materials_code_idx ON pcm.materials(unit_id,lower(code));
CREATE TABLE IF NOT EXISTS pcm.material_applications(id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),asset_id text NOT NULL,material_id text NOT NULL,position text NOT NULL DEFAULT '',expected_quantity numeric(20,6) CHECK(expected_quantity>0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(asset_id,material_id,position),FOREIGN KEY(asset_id,unit_id) REFERENCES pcm.assets(id,unit_id),FOREIGN KEY(material_id,unit_id) REFERENCES pcm.materials(id,unit_id));
CREATE TABLE IF NOT EXISTS pcm.order_materials(id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),order_id text NOT NULL,material_id text NOT NULL,quantity numeric(20,6) NOT NULL CHECK(quantity>0),unit text NOT NULL,unit_cost numeric(20,6) CHECK(unit_cost>=0),cost numeric(20,6),external_cost numeric(20,6) CHECK(external_cost>=0),kind text NOT NULL CHECK(kind IN ('RESERVATION','CONSUMPTION','RETURN')),reservation_id text REFERENCES pcm.order_materials(id),corrects_id text REFERENCES pcm.order_materials(id),reason text,idempotency_key text,created_by text REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(order_id,idempotency_key),FOREIGN KEY(order_id,unit_id) REFERENCES pcm.orders(id,unit_id),FOREIGN KEY(material_id,unit_id) REFERENCES pcm.materials(id,unit_id),CHECK(kind<>'RETURN' OR corrects_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS pcm_order_materials_order_idx ON pcm.order_materials(order_id);
CREATE OR REPLACE FUNCTION pcm.immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Historical record is immutable'; END $$;
CREATE TRIGGER pcm_order_materials_immutable BEFORE UPDATE OR DELETE ON pcm.order_materials FOR EACH ROW EXECUTE FUNCTION pcm.immutable_record();
CREATE TRIGGER pcm_asset_history_immutable BEFORE UPDATE OR DELETE ON pcm.asset_history FOR EACH ROW EXECUTE FUNCTION pcm.immutable_record();
CREATE TRIGGER pcm_order_status_immutable BEFORE UPDATE OR DELETE ON pcm.order_status_history FOR EACH ROW EXECUTE FUNCTION pcm.immutable_record();
CREATE OR REPLACE FUNCTION pcm.work_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' OR OLD.ended_at IS NOT NULL OR NEW.started_at<>OLD.started_at OR NEW.hourly_rate IS DISTINCT FROM OLD.hourly_rate OR NEW.user_id<>OLD.user_id OR NEW.order_id<>OLD.order_id THEN RAISE EXCEPTION 'Work cost snapshot is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER pcm_work_immutable BEFORE UPDATE OR DELETE ON pcm.work_sessions FOR EACH ROW EXECUTE FUNCTION pcm.work_immutable();
CREATE TABLE IF NOT EXISTS pcm.documents(id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),asset_id text,order_id text,request_id text,title text NOT NULL,kind text NOT NULL CHECK(kind IN ('MANUAL','PHOTO','ATTACHMENT')),filename text NOT NULL,mime_type text NOT NULL,language text,version text,manufacturer text,document_date date,replaces_id text REFERENCES pcm.documents(id),external_url text,storage_key text UNIQUE,size integer NOT NULL DEFAULT 0,sha256 text,current boolean NOT NULL DEFAULT true,created_by text NOT NULL REFERENCES sm5s.users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,unit_id),CHECK(num_nonnulls(asset_id,order_id,request_id)=1),FOREIGN KEY(asset_id,unit_id) REFERENCES pcm.assets(id,unit_id),FOREIGN KEY(order_id,unit_id) REFERENCES pcm.orders(id,unit_id),FOREIGN KEY(request_id,unit_id) REFERENCES pcm.requests(id,unit_id));
CREATE INDEX IF NOT EXISTS pcm_documents_targets_idx ON pcm.documents(asset_id,order_id,request_id);
-- Compound references keep correction/version chains inside their original unit.
ALTER TABLE pcm.order_materials ADD CONSTRAINT pcm_order_material_identity UNIQUE(id,unit_id,order_id,material_id);
ALTER TABLE pcm.order_materials ADD CONSTRAINT pcm_order_material_return_scope FOREIGN KEY(corrects_id,unit_id,order_id,material_id) REFERENCES pcm.order_materials(id,unit_id,order_id,material_id);
ALTER TABLE pcm.order_materials ADD CONSTRAINT pcm_order_material_reservation_scope FOREIGN KEY(reservation_id,unit_id,order_id,material_id) REFERENCES pcm.order_materials(id,unit_id,order_id,material_id);
ALTER TABLE pcm.documents ADD CONSTRAINT pcm_document_version_scope FOREIGN KEY(replaces_id,unit_id) REFERENCES pcm.documents(id,unit_id);
CREATE TRIGGER pcm_order_materials_lock BEFORE INSERT ON pcm.order_materials FOR EACH STATEMENT EXECUTE FUNCTION pcm.lock_integrity();
CREATE OR REPLACE FUNCTION pcm.material_movement_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original pcm.order_materials%ROWTYPE; used numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pcm.materials WHERE id=NEW.material_id AND unit_id=NEW.unit_id AND unit=NEW.unit) THEN RAISE EXCEPTION 'Material unit mismatch'; END IF;
 IF NEW.kind='RETURN' THEN
  SELECT * INTO original FROM pcm.order_materials WHERE id=NEW.corrects_id;
  IF original.id IS NULL OR original.kind<>'CONSUMPTION' OR original.unit<>NEW.unit OR NEW.unit_cost IS DISTINCT FROM original.unit_cost OR NEW.reason IS NULL OR length(trim(NEW.reason))=0 THEN RAISE EXCEPTION 'Invalid return'; END IF;
  SELECT COALESCE(sum(quantity),0) INTO used FROM pcm.order_materials WHERE corrects_id=NEW.corrects_id AND kind='RETURN';
  IF used+NEW.quantity>original.quantity THEN RAISE EXCEPTION 'Return exceeds consumption'; END IF;
 ELSIF NEW.corrects_id IS NOT NULL THEN RAISE EXCEPTION 'Only returns may correct consumption'; END IF;
 IF NEW.reservation_id IS NOT NULL THEN
  SELECT * INTO original FROM pcm.order_materials WHERE id=NEW.reservation_id;
  IF original.id IS NULL OR original.kind<>'RESERVATION' OR NEW.kind<>'CONSUMPTION' OR original.unit<>NEW.unit THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
  SELECT COALESCE(sum(quantity),0) INTO used FROM pcm.order_materials WHERE reservation_id=NEW.reservation_id AND kind='CONSUMPTION';
  IF used+NEW.quantity>original.quantity THEN RAISE EXCEPTION 'Consumption exceeds reservation'; END IF;
 END IF;
 IF NEW.cost IS DISTINCT FROM round(NEW.quantity*NEW.unit_cost*(CASE WHEN NEW.kind='RETURN' THEN -1 ELSE 1 END),6) THEN RAISE EXCEPTION 'Cost snapshot mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pcm_material_movement_integrity BEFORE INSERT ON pcm.order_materials FOR EACH ROW EXECUTE FUNCTION pcm.material_movement_integrity();
CREATE TRIGGER pcm_work_lock BEFORE INSERT OR UPDATE ON pcm.work_sessions FOR EACH STATEMENT EXECUTE FUNCTION pcm.lock_integrity();
CREATE OR REPLACE FUNCTION pcm.work_interval_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM pcm.work_sessions WHERE user_id=NEW.user_id AND id<>NEW.id AND started_at<COALESCE(NEW.ended_at,'infinity'::timestamptz) AND COALESCE(ended_at,'infinity'::timestamptz)>NEW.started_at) THEN RAISE EXCEPTION 'Overlapping work sessions'; END IF;
 IF NEW.ended_at IS NOT NULL AND (NEW.hours IS DISTINCT FROM round(extract(epoch FROM (NEW.ended_at-NEW.started_at))/3600,6) OR NEW.cost IS DISTINCT FROM round(NEW.hours*NEW.hourly_rate,6)) THEN RAISE EXCEPTION 'Work cost snapshot mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pcm_work_interval_integrity BEFORE INSERT OR UPDATE ON pcm.work_sessions FOR EACH ROW EXECUTE FUNCTION pcm.work_interval_integrity();
INSERT INTO pcm.schema_migrations(version) VALUES('010') ON CONFLICT DO NOTHING;
