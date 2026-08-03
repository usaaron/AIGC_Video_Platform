import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../config.js'
import { hashPassword } from '../core/auth/password.js'
import { AccountDatabase } from '../infra/postgres.js'

const confirmation = 'RESET_BOOTSTRAP_ADMIN_PASSWORD'
const config = loadConfig()

if (process.env.CONFIRM_BOOTSTRAP_ADMIN_PASSWORD_RESET !== confirmation) {
  throw new Error(
    `Set CONFIRM_BOOTSTRAP_ADMIN_PASSWORD_RESET=${confirmation} to confirm the administrator password reset`,
  )
}
if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required')

const database = new AccountDatabase(config.DATABASE_URL)

try {
  await database.ensureLatestMigrations()
  const result = await database.transaction(async (client) => {
    const identityResult = await client.query<{
      identity_id: string
      user_id: string
      tenant_id: string
    }>(
      `
      SELECT DISTINCT ON (ai.id)
        ai.id AS identity_id,
        ai.user_id,
        tm.tenant_id
      FROM auth_identities ai
      JOIN tenant_memberships tm ON tm.user_id = ai.user_id
      WHERE ai.provider = 'local'
        AND lower(ai.email) = lower($1)
        AND tm.status = 'active'
        AND tm.roles && ARRAY['admin', 'super_admin', 'owner']::text[]
      ORDER BY ai.id, tm.is_primary DESC, tm.created_at ASC
      `,
      [config.BOOTSTRAP_ADMIN_EMAIL],
    )
    const identity = identityResult.rows[0]
    if (!identity) {
      throw new Error('Configured bootstrap administrator does not exist or has no administrator role')
    }

    await client.query(
      `
      UPDATE auth_identities
      SET password_hash = $2, status = 'active', updated_at = now()
      WHERE id = $1
      `,
      [identity.identity_id, hashPassword(config.BOOTSTRAP_ADMIN_PASSWORD)],
    )
    const revoked = await client.query(
      `
      UPDATE sessions
      SET revoked_at = now()
      WHERE membership_id IN (
        SELECT id FROM tenant_memberships WHERE user_id = $1
      )
        AND revoked_at IS NULL
      `,
      [identity.user_id],
    )
    await client.query(
      `
      INSERT INTO audit_log_entries (
        id,
        tenant_id,
        user_id,
        actor_user_id,
        action,
        resource_type,
        resource_id,
        metadata
      )
      VALUES ($1, $2, $3, NULL, 'account.bootstrap_admin_password_reset', 'auth_identity', $4, $5::jsonb)
      `,
      [
        randomUUID(),
        identity.tenant_id,
        identity.user_id,
        identity.identity_id,
        JSON.stringify({ source: 'operator_cli', revokedSessions: revoked.rowCount ?? 0 }),
      ],
    )
    return { revokedSessions: revoked.rowCount ?? 0 }
  })

  process.stdout.write(
    `[accounts:reset-admin-password] administrator password reset; revoked sessions: ${result.revokedSessions}\n`,
  )
} finally {
  await database.close()
}
