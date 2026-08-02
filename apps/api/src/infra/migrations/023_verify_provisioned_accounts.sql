UPDATE auth_identities AS identity
SET email_verified_at = COALESCE(identity.email_verified_at, identity.created_at),
    email_verification_status = 'verified',
    updated_at = now()
WHERE identity.provider = 'local'
  AND identity.status = 'active'
  AND identity.email_verification_status = 'unverified'
  AND EXISTS (
    SELECT 1
    FROM audit_log_entries AS audit
    WHERE audit.resource_type = 'user'
      AND audit.resource_id = identity.user_id
      AND audit.action IN ('account.created', 'admin.account.created')
  );
