ALTER TABLE sm5s.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE sm5s.users ADD CONSTRAINT users_role_check CHECK(role IN ('MASTER','ADMIN','AUDITOR','USER'));

CREATE TABLE IF NOT EXISTS sm5s.module_access (
 user_id text NOT NULL REFERENCES sm5s.users(id) ON DELETE CASCADE,
 module text NOT NULL CHECK(module IN ('5s','maintenance')),
 level text NOT NULL CHECK(level IN ('ADMIN','USER')),
 sublevel text NOT NULL CHECK(sublevel IN ('VIEWER','OPERATOR','MANAGER')),
 PRIMARY KEY(user_id,module),
 CHECK(level <> 'ADMIN' OR sublevel='MANAGER')
);

-- Run backfill once: subsequent migrations must not restore revoked access.
INSERT INTO sm5s.module_access(user_id,module,level,sublevel)
 SELECT id,'5s',CASE WHEN role='ADMIN' THEN 'ADMIN' ELSE 'USER' END,
 CASE WHEN role='ADMIN' THEN 'MANAGER' ELSE 'OPERATOR' END
 FROM sm5s.users WHERE role IN ('ADMIN','AUDITOR')
 AND NOT EXISTS(SELECT 1 FROM sm5s.schema_migrations WHERE version='003')
 ON CONFLICT DO NOTHING;
INSERT INTO sm5s.schema_migrations(version) VALUES('003') ON CONFLICT DO NOTHING;
