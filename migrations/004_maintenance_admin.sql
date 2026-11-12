-- Provision only once; never reset an existing account's credentials or restore revoked grants.
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sm5s.schema_migrations WHERE version='004') THEN
  INSERT INTO sm5s.users(id,email,name,role,password_hash,must_change_password,temporary_expires_at)
  VALUES('maintenance-michelli-rudnik','michelli.rudnik@steelmast.com.br','Michelli Rudnik','USER',
   'scrypt$8236d5c29e35746f1f2035160168490ae1f427dd94005632$24582da42bb5ec87b6acfa7c393ba500fb22e5daa387facbccf58ecdd7ae953925c63f31c639b88e1eff6e6b2e368fbf6e2073354a50355d471435e03be842ef',
   true,now()+interval '72 hours') ON CONFLICT(email) DO NOTHING;
  INSERT INTO sm5s.module_access(user_id,module,level,sublevel)
   SELECT id,'maintenance','ADMIN','MANAGER' FROM sm5s.users WHERE email='michelli.rudnik@steelmast.com.br'
   ON CONFLICT(user_id,module) DO UPDATE SET level='ADMIN',sublevel='MANAGER';
  INSERT INTO sm5s.schema_migrations(version) VALUES('004');
 END IF;
END $$;
