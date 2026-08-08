ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS organization_type TEXT NOT NULL DEFAULT 'enterprise';

UPDATE tenants
SET organization_type = 'system',
    updated_at = now()
WHERE is_system = true
  AND organization_type <> 'system';

UPDATE tenants
SET organization_type = 'synthetic',
    updated_at = now()
WHERE is_system = false
  AND id LIKE 'tenant-synthetic-%'
  AND organization_type <> 'synthetic';

UPDATE tenants AS t
SET organization_type = 'personal',
    updated_at = now()
WHERE t.is_system = false
  AND t.organization_type = 'enterprise'
  AND EXISTS (
    SELECT 1
    FROM tenant_memberships m
    WHERE m.tenant_id = t.id
      AND m.status = 'active'
      AND m.roles = ARRAY['member']::text[]
  )
  AND NOT EXISTS (
    SELECT 1
    FROM tenant_memberships m
    WHERE m.tenant_id = t.id
      AND m.status = 'active'
      AND m.roles && ARRAY[
        'owner',
        'super_admin',
        'admin',
        'organization_admin',
        'organization_member'
      ]::text[]
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_organization_type_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_organization_type_check
      CHECK (organization_type IN ('system', 'personal', 'enterprise', 'synthetic'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenants_organization_type_idx
  ON tenants (organization_type, status);

ALTER TABLE tenant_invitations
  ADD COLUMN IF NOT EXISTS invitation_scope TEXT;

UPDATE tenant_invitations AS invitations
SET invitation_scope = CASE
    WHEN invitations.roles && ARRAY['organization_admin', 'organization_member']::text[] THEN 'organization_membership'
    WHEN tenants.is_system = true OR invitations.roles && ARRAY['owner', 'super_admin', 'admin']::text[] THEN 'system_account'
    ELSE 'platform_registration'
  END
FROM tenants
WHERE tenants.id = invitations.tenant_id
  AND invitations.invitation_scope IS NULL;

ALTER TABLE tenant_invitations
  ALTER COLUMN invitation_scope SET DEFAULT 'organization_membership',
  ALTER COLUMN invitation_scope SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_invitations_scope_check'
  ) THEN
    ALTER TABLE tenant_invitations
      ADD CONSTRAINT tenant_invitations_scope_check
      CHECK (invitation_scope IN ('platform_registration', 'organization_membership', 'system_account'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenant_invitations_scope_idx
  ON tenant_invitations (invitation_scope, status);
