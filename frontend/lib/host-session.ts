const TOKEN_KEY = "seqora.script-master.host-token";
const PROJECT_KEY = "seqora.script-master.host-project";
const REFRESH_MARGIN_MS = 60_000;
const REFRESH_RETRY_MS = 10_000;
const RELAUNCH_MESSAGE = "主站登录状态已失效或账号发生变化，请从主站重新打开剧本大师。";

export class HostSessionError extends Error {
  readonly retryable = false;
  constructor(message = RELAUNCH_MESSAGE) {
    super(message);
    this.name = "HostSessionError";
  }
}

export class HostSessionUnavailableError extends Error {
  readonly retryable = true;
  readonly status = 503;
  constructor() {
    super("暂时无法验证主站登录状态，请稍后重试。当前账号和已保存内容不会切换。");
    this.name = "HostSessionUnavailableError";
  }
}

interface TicketIdentity {
  tenantId: string;
  actorId: string;
  expiresAt: number;
}

// Claims only select browser storage and refresh timing. The backend must verify
// the ticket signature, expiry, permissions and ownership on every API request.
function ticketIdentity(token: string): TicketIdentity {
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) throw new Error();
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as TicketIdentity;
    if (typeof claims.tenantId !== "string" || !claims.tenantId.trim()
      || typeof claims.actorId !== "string" || !claims.actorId.trim()
      || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= 0) throw new Error();
    return claims;
  } catch {
    throw new HostSessionError();
  }
}

function sameIdentity(left: TicketIdentity, right: TicketIdentity): boolean {
  return left.tenantId === right.tenantId && left.actorId === right.actorId;
}

interface HostSessionOptions {
  browser: () => Window | undefined;
  launchUrl: () => string;
  required: () => boolean;
  fetch: typeof fetch;
  now: () => number;
}

export function createHostSession(options: HostSessionOptions) {
  let token: string | null = null;
  let projectId: string | null = null;
  let initialized = false;
  let validated = false;
  let anonymous = false;
  let identity: TicketIdentity | null = null;
  let failure: HostSessionError | null = null;
  let refreshing: Promise<string | null> | null = null;
  let retryAt = 0;
  let refreshError: HostSessionUnavailableError | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(error: HostSessionError) => void>();
  const lifetime = new AbortController();

  function readInitialTicket(): void {
    const browser = options.browser();
    if (initialized || !browser?.location) return;
    initialized = true;
    const fragment = new URLSearchParams(browser.location.hash.replace(/^#/, ""));
    token = fragment.get("host_token");
    projectId = new URLSearchParams(browser.location.search).get("host_project_id");
    try {
      if (token) {
        browser.sessionStorage.setItem(TOKEN_KEY, token);
        if (projectId) browser.sessionStorage.setItem(PROJECT_KEY, projectId);
        else browser.sessionStorage.removeItem(PROJECT_KEY);
      } else {
        token = browser.sessionStorage.getItem(TOKEN_KEY);
        projectId ??= token ? browser.sessionStorage.getItem(PROJECT_KEY) : null;
      }
    } catch {
      // Memory still retains the ticket and project scope when storage is denied.
    }
    if (fragment.has("host_token")) {
      fragment.delete("host_token");
      const hash = fragment.toString();
      browser.history.replaceState(null, "", `${browser.location.pathname}${browser.location.search}${hash ? `#${hash}` : ""}`);
    }
  }

  function required(): boolean {
    readInitialTicket();
    return options.required() || Boolean(options.launchUrl() || token);
  }

  function fail(): HostSessionError {
    if (failure) return failure;
    failure = new HostSessionError();
    token = null;
    validated = false;
    clearTimeout(timer);
    lifetime.abort(failure);
    try {
      options.browser()?.sessionStorage.removeItem(TOKEN_KEY);
      options.browser()?.sessionStorage.removeItem(PROJECT_KEY);
    } catch { /* Storage access is optional; the in-memory session stays closed. */ }
    listeners.forEach((listener) => listener(failure!));
    return failure;
  }

  function assertActive(): void {
    if (failure) throw failure;
    if (required() && (!validated || anonymous)) throw new HostSessionError();
  }

  function validToken(): string | null {
    return validated && identity && identity.expiresAt * 1000 > options.now() ? token : null;
  }

  async function refresh(): Promise<string> {
    try {
      const browser = options.browser();
      if (!browser?.location) throw new HostSessionError();
      if (anonymous) throw new HostSessionError();
      const previous = identity ?? (token ? ticketIdentity(token) : null);
      const endpoint = new URL(options.launchUrl() || "/api/v1/script-master/launch", browser.location.origin);
      if (endpoint.origin !== browser.location.origin || endpoint.username || endpoint.password) throw new HostSessionError();
      if (projectId) endpoint.searchParams.set("projectId", projectId);
      else endpoint.searchParams.delete("projectId");
      let response: Response;
      try {
        response = await options.fetch(endpoint.toString(), {
          method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
          headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new HostSessionUnavailableError();
      }
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        throw new HostSessionUnavailableError();
      }
      if (!response.ok) throw new HostSessionError();
      let result: { enabled?: boolean; launchUrl?: string };
      try {
        result = await response.json() as typeof result;
      } catch (error) {
        if (error instanceof TypeError) throw new HostSessionUnavailableError();
        throw error;
      }
      if (result.enabled !== true || typeof result.launchUrl !== "string") throw new HostSessionError();
      const launch = new URL(result.launchUrl, browser.location.origin);
      if (launch.origin !== browser.location.origin) throw new HostSessionError();
      const nextToken = new URLSearchParams(launch.hash.slice(1)).get("host_token");
      if (!nextToken) throw new HostSessionError();
      const nextIdentity = ticketIdentity(nextToken);
      if ((previous && !sameIdentity(previous, nextIdentity))
        || nextIdentity.expiresAt * 1000 <= options.now() + REFRESH_MARGIN_MS) throw new HostSessionError();
      if (failure) throw failure;
      identity = nextIdentity;
      token = nextToken;
      validated = true;
      retryAt = 0;
      refreshError = null;
      try {
        browser.sessionStorage.setItem(TOKEN_KEY, token);
        if (projectId) browser.sessionStorage.setItem(PROJECT_KEY, projectId);
        else browser.sessionStorage.removeItem(PROJECT_KEY);
      } catch { /* Memory fallback. */ }
      clearTimeout(timer);
      timer = setTimeout(() => { void ensureHostToken(true).catch(() => {}); },
        identity.expiresAt * 1000 - options.now() - REFRESH_MARGIN_MS);
      return token;
    } catch (error) {
      if (error instanceof HostSessionUnavailableError && !failure) {
        refreshError = error;
        retryAt = options.now() + REFRESH_RETRY_MS;
        clearTimeout(timer);
        const previousToken = validToken();
        if (previousToken) {
          // Retry only while an already validated ticket is usable. After
          // expiry, subsequent callers may retry, but no expired bearer is sent.
          timer = setTimeout(() => { void ensureHostToken().catch(() => {}); },
            Math.min(REFRESH_RETRY_MS, identity!.expiresAt * 1000 - options.now()));
          return previousToken;
        }
        throw error;
      }
      // Never include launch URLs, tickets or upstream response bodies in errors.
      throw fail();
    }
  }

  async function ensureHostToken(forceRefresh = false): Promise<string | null> {
    if (failure) throw failure;
    if (!required()) {
      anonymous = true;
      return null;
    }
    if (refreshing) return refreshing;
    if (refreshError && options.now() < retryAt) {
      const previousToken = validToken();
      if (previousToken) return previousToken;
      throw refreshError;
    }
    if (!refreshError && validated && identity && !forceRefresh
      && identity.expiresAt * 1000 - options.now() > REFRESH_MARGIN_MS) return token;
    refreshing = refresh();
    try { return await refreshing; } finally { refreshing = null; }
  }

  return {
    ensureHostToken,
    // Compatibility only: reading a ticket does not authorize cache access.
    hostToken(): string | null {
      if (failure) return null;
      readInitialTicket();
      return identity ? validToken() : token;
    },
    hostProjectId(): string | null { readInitialTicket(); return projectId; },
    assertActive,
    storageKey(key: string): string {
      assertActive();
      if (!identity) { anonymous = true; return key; }
      return `${key}:host:${encodeURIComponent(identity.tenantId)}:${encodeURIComponent(identity.actorId)}`;
    },
    subscribe(listener: (error: HostSessionError) => void): () => void {
      listeners.add(listener);
      if (failure) listener(failure);
      return () => { listeners.delete(listener); };
    },
    signal: lifetime.signal,
  };
}

const session = createHostSession({
  browser: () => typeof window === "undefined" ? undefined : window,
  launchUrl: () => process.env.NEXT_PUBLIC_HOST_LAUNCH_URL?.trim() ?? "",
  required: () => Boolean(process.env.NEXT_PUBLIC_BASE_PATH?.trim()),
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
});

export const hostToken = session.hostToken;
export const ensureHostToken = session.ensureHostToken;
export const hostProjectId = session.hostProjectId;
export const projectStorageKey = session.storageKey;
export const assertHostSessionActive = session.assertActive;
export const subscribeHostSessionFailure = session.subscribe;
export const hostSessionSignal = session.signal;
