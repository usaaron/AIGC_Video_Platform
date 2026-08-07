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
  AND (
    SELECT count(*)
    FROM tenant_memberships m
    WHERE m.tenant_id = t.id
      AND m.status = 'active'
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM tenant_memberships m
    WHERE m.tenant_id = t.id
      AND m.status = 'active'
      AND m.is_primary = true
      AND m.roles = ARRAY['member']::text[]
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_system_organization_type_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_system_organization_type_check
      CHECK (
        (is_system = true AND organization_type = 'system')
        OR (is_system = false AND organization_type <> 'system')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenants_organization_type_idx
  ON tenants (organization_type, status);

ALTER TABLE tenant_invitations
  ADD COLUMN IF NOT EXISTS invitation_scope TEXT;

UPDATE tenant_invitations AS invitations
SET roles = ARRAY['organization_member']::text[],
    updated_at = now()
FROM tenants
WHERE tenants.id = invitations.tenant_id
  AND tenants.organization_type = 'enterprise'
  AND invitations.roles = ARRAY['member']::text[];

UPDATE tenant_invitations AS invitations
SET invitation_scope = CASE
    WHEN tenants.organization_type = 'system' THEN 'system_account'
    WHEN tenants.organization_type = 'personal'
      AND invitations.roles = ARRAY['member']::text[] THEN 'platform_registration'
    ELSE 'organization_membership'
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_invitations_scope_roles_check'
  ) THEN
    ALTER TABLE tenant_invitations
      ADD CONSTRAINT tenant_invitations_scope_roles_check
      CHECK (
        (
          invitation_scope = 'platform_registration'
          AND roles = ARRAY['member']::text[]
        )
        OR (
          invitation_scope = 'organization_membership'
          AND coalesce(array_length(roles, 1), 0) > 0
          AND roles <@ ARRAY['organization_admin', 'organization_member']::text[]
        )
        OR (
          invitation_scope = 'system_account'
          AND coalesce(array_length(roles, 1), 0) > 0
          AND roles <@ ARRAY['owner', 'super_admin', 'admin']::text[]
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenant_invitations_scope_idx
  ON tenant_invitations (invitation_scope, status);

CREATE OR REPLACE FUNCTION enforce_tenant_invitation_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_organization_type text;
BEGIN
  SELECT organization_type
    INTO tenant_organization_type
  FROM tenants
  WHERE id = NEW.tenant_id;

  IF tenant_organization_type IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.invitation_scope = 'platform_registration' AND tenant_organization_type <> 'personal' THEN
    RAISE EXCEPTION 'PLATFORM_REGISTRATION_INVITATION_REQUIRES_PERSONAL_ORGANIZATION'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.invitation_scope = 'organization_membership' AND tenant_organization_type <> 'enterprise' THEN
    RAISE EXCEPTION 'ORGANIZATION_MEMBERSHIP_INVITATION_REQUIRES_ENTERPRISE_ORGANIZATION'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.invitation_scope = 'system_account' AND tenant_organization_type <> 'system' THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_INVITATION_REQUIRES_SYSTEM_ORGANIZATION'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenant_invitations_scope_organization_type ON tenant_invitations;
CREATE CONSTRAINT TRIGGER tenant_invitations_scope_organization_type
AFTER INSERT OR UPDATE OF tenant_id, roles, invitation_scope ON tenant_invitations
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION enforce_tenant_invitation_scope();

CREATE OR REPLACE FUNCTION enforce_tenant_organization_type_invitations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM tenant_invitations i
    WHERE i.tenant_id = NEW.id
      AND i.status = 'pending'
      AND (
        (i.invitation_scope = 'platform_registration' AND NEW.organization_type <> 'personal')
        OR (i.invitation_scope = 'organization_membership' AND NEW.organization_type <> 'enterprise')
        OR (i.invitation_scope = 'system_account' AND NEW.organization_type <> 'system')
      )
  ) THEN
    RAISE EXCEPTION 'ORGANIZATION_TYPE_HAS_INCOMPATIBLE_PENDING_INVITATIONS'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenants_organization_type_pending_invitations ON tenants;
CREATE CONSTRAINT TRIGGER tenants_organization_type_pending_invitations
AFTER UPDATE OF organization_type ON tenants
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION enforce_tenant_organization_type_invitations();
