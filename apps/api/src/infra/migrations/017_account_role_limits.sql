DO $$
BEGIN
  IF (
    SELECT count(DISTINCT m.user_id)
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id
    WHERE u.status = 'active'
      AND m.status = 'active'
      AND m.roles @> ARRAY['owner']::text[]
  ) > 1 THEN
    RAISE EXCEPTION 'Only one active owner account is allowed before applying 017_account_role_limits';
  END IF;

  IF (
    SELECT count(DISTINCT m.user_id)
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id
    WHERE u.status = 'active'
      AND m.status = 'active'
      AND m.roles @> ARRAY['super_admin']::text[]
  ) > 5 THEN
    RAISE EXCEPTION 'At most five active super admin accounts are allowed before applying 017_account_role_limits';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_platform_role_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_owner_users integer;
  active_super_admin_users integer;
BEGIN
  SELECT count(DISTINCT m.user_id)
    INTO active_owner_users
  FROM tenant_memberships m
  JOIN users u ON u.id = m.user_id
  WHERE u.status = 'active'
    AND m.status = 'active'
    AND m.roles @> ARRAY['owner']::text[];

  IF active_owner_users > 1 THEN
    RAISE EXCEPTION 'Only one active owner account is allowed'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(DISTINCT m.user_id)
    INTO active_super_admin_users
  FROM tenant_memberships m
  JOIN users u ON u.id = m.user_id
  WHERE u.status = 'active'
    AND m.status = 'active'
    AND m.roles @> ARRAY['super_admin']::text[];

  IF active_super_admin_users > 5 THEN
    RAISE EXCEPTION 'At most five active super admin accounts are allowed'
      USING ERRCODE = '23514';
  END IF;

  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS tenant_memberships_platform_role_limits ON tenant_memberships;
CREATE CONSTRAINT TRIGGER tenant_memberships_platform_role_limits
AFTER INSERT OR UPDATE OF user_id, roles, status OR DELETE ON tenant_memberships
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION enforce_platform_role_limits();

DROP TRIGGER IF EXISTS users_platform_role_limits ON users;
CREATE CONSTRAINT TRIGGER users_platform_role_limits
AFTER UPDATE OF status ON users
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION enforce_platform_role_limits();
