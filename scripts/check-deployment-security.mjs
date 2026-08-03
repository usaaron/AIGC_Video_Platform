import { readFile } from 'node:fs/promises'

const caddyfile = await readFile('deploy/Caddyfile', 'utf8')
const requiredPatterns = [
  [/strict_sni_host\s+on/, 'strict SNI and Host matching'],
  [
    /handle \/admin\s*\{[\s\S]*?forward_auth api:8787[\s\S]*?uri \/api\/v1\/admin\/access/,
    '/admin authorization',
  ],
  [
    /handle_path \/admin\/\*\s*\{[\s\S]*?forward_auth api:8787[\s\S]*?uri \/api\/v1\/admin\/access/,
    '/admin/* authorization',
  ],
  [
    /Content-Security-Policy[\s\S]*?form-action 'self'[\s\S]*?frame-ancestors 'none'/,
    'CSP form and framing restrictions',
  ],
]

const missing = requiredPatterns
  .filter(([pattern]) => !pattern.test(caddyfile))
  .map(([, description]) => description)

if (missing.length) {
  console.error(`Deployment security controls are missing: ${missing.join(', ')}`)
  process.exit(1)
}

console.log('Deployment security controls are present.')
