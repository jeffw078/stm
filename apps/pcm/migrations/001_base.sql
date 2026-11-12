CREATE SCHEMA IF NOT EXISTS pcm;
CREATE TABLE IF NOT EXISTS pcm.schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pcm.integrity_lock(id integer PRIMARY KEY CHECK(id=1));
INSERT INTO pcm.integrity_lock(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS pcm.teams(id text PRIMARY KEY,unit_id text NOT NULL REFERENCES sm5s.units(id),name text NOT NULL,weekly_hours numeric(12,4) CHECK(weekly_hours>=0),active boolean NOT NULL DEFAULT true,UNIQUE(id,unit_id),UNIQUE(unit_id,name));
CREATE TABLE IF NOT EXISTS pcm.memberships(
 user_id text PRIMARY KEY REFERENCES sm5s.users(id),role text NOT NULL CHECK(role IN ('REQUESTER','TECHNICIAN','PLANNER','MANAGER','VIEWER')),
 unit_ids text[] NOT NULL DEFAULT '{}',team_ids text[] NOT NULL DEFAULT '{}',permissions jsonb NOT NULL DEFAULT '[]',revision integer NOT NULL DEFAULT 1,
 CHECK(jsonb_typeof(permissions)='array'),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pcm.settings(unit_id text PRIMARY KEY REFERENCES sm5s.units(id),validation_required boolean NOT NULL DEFAULT true,timezone text NOT NULL DEFAULT 'America/Sao_Paulo',asset_code_prefix text,parameters jsonb NOT NULL DEFAULT '{}',revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS pcm.audit_events(id text PRIMARY KEY,actor_id text REFERENCES sm5s.users(id),unit_id text REFERENCES sm5s.units(id),entity_kind text NOT NULL,entity_id text NOT NULL,action text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pcm_events_entity_idx ON pcm.audit_events(entity_kind,entity_id,created_at);
CREATE TABLE IF NOT EXISTS pcm.notifications(id text PRIMARY KEY,user_id text NOT NULL REFERENCES sm5s.users(id),unit_id text REFERENCES sm5s.units(id),kind text NOT NULL,entity_id text,title text NOT NULL,message text NOT NULL DEFAULT '',read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pcm_notifications_user_idx ON pcm.notifications(user_id,created_at DESC);
INSERT INTO pcm.schema_migrations(version) VALUES('001') ON CONFLICT DO NOTHING;
