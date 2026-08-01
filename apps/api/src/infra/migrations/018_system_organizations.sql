ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

INSERT INTO tenants (id, name, status, is_system, created_at, updated_at)
VALUES ('tenant-seqora-demo', 'Seqora Local', 'active', true, now(), now())
ON CONFLICT (id)
DO UPDATE SET is_system = true,
              status = 'active',
              updated_at = now();

CREATE UNIQUE INDEX IF NOT EXISTS tenants_single_system_organization_unique
  ON tenants (is_system)
  WHERE is_system;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_system_organization_active_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_system_organization_active_check
      CHECK (NOT is_system OR status = 'active');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION protect_system_organization_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'SYSTEM_ORGANIZATION_PROTECTED'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system AND NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION 'SYSTEM_ORGANIZATION_PROTECTED'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.is_system AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'SYSTEM_ORGANIZATION_PROTECTED'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenants_system_organization_lifecycle ON tenants;
CREATE TRIGGER tenants_system_organization_lifecycle
BEFORE UPDATE OR DELETE ON tenants
FOR EACH ROW
EXECUTE FUNCTION protect_system_organization_lifecycle();
