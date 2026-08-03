WITH selected_memberships AS (
  SELECT DISTINCT ON (m.user_id)
    m.user_id,
    m.id AS membership_id,
    m.tenant_id,
    b.credits
  FROM tenant_memberships m
  JOIN users u ON u.id = m.user_id
  JOIN tenants t ON t.id = m.tenant_id
  JOIN billing_accounts b ON b.membership_id = m.id
  WHERE u.status = 'active'
    AND t.status = 'active'
    AND m.status = 'active'
  ORDER BY m.user_id, m.is_primary DESC, m.created_at ASC, m.id ASC
),
inserted_grants AS (
  INSERT INTO billing_ledger_entries (
    id,
    tenant_id,
    user_id,
    membership_id,
    reference_id,
    related_entry_id,
    entry_type,
    amount,
    balance,
    description,
    created_by_user_id,
    created_at,
    updated_at
  )
  SELECT
    'ledger-existing-welcome-' || md5(user_id || ':' || membership_id),
    tenant_id,
    user_id,
    membership_id,
    'existing-user-welcome-20260803',
    NULL,
    'grant',
    2000,
    credits + 2000,
    '存量账号资格补发',
    NULL,
    now(),
    now()
  FROM selected_memberships
  ON CONFLICT (tenant_id, user_id, reference_id) DO NOTHING
  RETURNING membership_id, amount
)
UPDATE billing_accounts AS account
SET credits = account.credits + grant.amount,
    updated_at = now()
FROM inserted_grants AS grant
WHERE account.membership_id = grant.membership_id;
