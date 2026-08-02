DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_memberships_roles_known_check'
  ) THEN
    ALTER TABLE tenant_memberships
      DROP CONSTRAINT tenant_memberships_roles_known_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_invitations_roles_known_check'
  ) THEN
    ALTER TABLE tenant_invitations
      DROP CONSTRAINT tenant_invitations_roles_known_check;
  END IF;

  ALTER TABLE tenant_memberships
    ADD CONSTRAINT tenant_memberships_roles_known_check
    CHECK (
      coalesce(array_length(roles, 1), 0) > 0
      AND roles <@ ARRAY[
        'member',
        'admin',
        'organization_admin',
        'organization_member',
        'super_admin',
        'owner'
      ]::text[]
    );

  ALTER TABLE tenant_invitations
    ADD CONSTRAINT tenant_invitations_roles_known_check
    CHECK (
      coalesce(array_length(roles, 1), 0) > 0
      AND roles <@ ARRAY[
        'member',
        'admin',
        'organization_admin',
        'organization_member',
        'super_admin',
        'owner'
      ]::text[]
    );
END $$;
