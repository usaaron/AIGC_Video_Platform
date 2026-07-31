WITH expanded AS (
  SELECT
    id,
    ord,
    CASE role
      WHEN 'creator' THEN 'member'
      ELSE role
    END AS normalized_role
  FROM tenant_memberships,
    unnest(roles) WITH ORDINALITY AS role_value(role, ord)
), ranked AS (
  SELECT id, normalized_role, min(ord) AS first_ord
  FROM expanded
  WHERE normalized_role = ANY(ARRAY['member', 'admin', 'super_admin', 'owner']::text[])
  GROUP BY id, normalized_role
), normalized AS (
  SELECT id, array_agg(normalized_role ORDER BY first_ord) AS roles
  FROM ranked
  GROUP BY id
)
UPDATE tenant_memberships AS memberships
SET roles = normalized.roles,
    updated_at = now()
FROM normalized
WHERE memberships.id = normalized.id
  AND memberships.roles IS DISTINCT FROM normalized.roles;

WITH expanded AS (
  SELECT
    id,
    ord,
    CASE role
      WHEN 'creator' THEN 'member'
      ELSE role
    END AS normalized_role
  FROM tenant_invitations,
    unnest(roles) WITH ORDINALITY AS role_value(role, ord)
), ranked AS (
  SELECT id, normalized_role, min(ord) AS first_ord
  FROM expanded
  WHERE normalized_role = ANY(ARRAY['member', 'admin', 'super_admin', 'owner']::text[])
  GROUP BY id, normalized_role
), normalized AS (
  SELECT id, array_agg(normalized_role ORDER BY first_ord) AS roles
  FROM ranked
  GROUP BY id
)
UPDATE tenant_invitations AS invitations
SET roles = normalized.roles,
    updated_at = now()
FROM normalized
WHERE invitations.id = normalized.id
  AND invitations.roles IS DISTINCT FROM normalized.roles;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_memberships_roles_known_check'
  ) THEN
    ALTER TABLE tenant_memberships
      ADD CONSTRAINT tenant_memberships_roles_known_check
      CHECK (
        coalesce(array_length(roles, 1), 0) > 0
        AND roles <@ ARRAY['member', 'admin', 'super_admin', 'owner']::text[]
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_invitations_roles_known_check'
  ) THEN
    ALTER TABLE tenant_invitations
      ADD CONSTRAINT tenant_invitations_roles_known_check
      CHECK (
        coalesce(array_length(roles, 1), 0) > 0
        AND roles <@ ARRAY['member', 'admin', 'super_admin', 'owner']::text[]
      );
  END IF;
END $$;
