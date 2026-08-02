import http from 'k6/http'
import { check, fail, sleep } from 'k6'

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')
const email = __ENV.EMAIL || 'member@seqora.local'
const password = __ENV.PASSWORD || 'MemberPassword123!'
const projectId = __ENV.PROJECT_ID || 'project-midnight-film'
const mode = (__ENV.K6_MODE || 'smoke').toLowerCase()
const readOnlyPath = '/api/v1/auth/me'

export const options = buildOptions(mode)

export function setup() {
  const login = http.post(`${baseUrl}/api/v1/auth/login`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
  })
  check(login, { 'login succeeded': (response) => response.status === 200 }) || fail('login failed')

  const sessionCookie = login.cookies.seqora_session?.[0]?.value
  if (!sessionCookie) fail('missing session cookie')

  return {
    cookie: `seqora_session=${sessionCookie}`,
  }
}

export default function (data) {
  const headers = {
    cookie: data.cookie,
    'content-type': 'application/json',
  }

  const me = http.get(`${baseUrl}${readOnlyPath}`, { headers })
  check(me, { 'auth/me returns 200': (response) => response.status === 200 })

  const project = http.get(`${baseUrl}/api/v1/projects/${projectId}`, { headers })
  check(project, { 'project returns 200': (response) => response.status === 200 })

  const summary = http.get(`${baseUrl}/api/v1/billing/summary`, { headers })
  check(summary, { 'billing summary returns 200': (response) => response.status === 200 })

  const readiness = http.get(`${baseUrl}/api/v1/health/readiness`)
  check(readiness, {
    'readiness returns 200 or 503': (response) => response.status === 200 || response.status === 503,
  })

  sleep(1)
}

function buildOptions(selectedMode) {
  if (selectedMode === 'breakpoint') {
    return {
      scenarios: {
        breakpoint: {
          executor: 'ramping-arrival-rate',
          startRate: 5,
          timeUnit: '1s',
          preAllocatedVUs: 50,
          maxVUs: 500,
          stages: [
            { target: 25, duration: '2m' },
            { target: 50, duration: '2m' },
            { target: 100, duration: '2m' },
            { target: 150, duration: '2m' },
            { target: 250, duration: '2m' },
          ],
          exec: 'default',
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.1'],
      },
      noConnectionReuse: false,
    }
  }

  return {
    scenarios: {
      smoke: {
        executor: 'constant-vus',
        vus: Number(__ENV.VUS || 5),
        duration: __ENV.DURATION || '2m',
        exec: 'default',
      },
    },
    thresholds: {
      http_req_failed: ['rate<0.01'],
      http_req_duration: ['p(95)<1000'],
    },
    noConnectionReuse: false,
  }
}
