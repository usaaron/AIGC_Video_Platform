export const NOW = 1_800_000_000_000;

export function ticket({ tenantId = "tenant-a", actorId = "actor-a", expiresAt = NOW / 1000 + 300 } = {}) {
  return `${Buffer.from(JSON.stringify({ tenantId, actorId, expiresAt })).toString("base64url")}.test-signature`;
}

export function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

export function browser(url = "https://studio.test/script-master", sessionStorage = storage()) {
  const location = new URL(url);
  return {
    location, sessionStorage, localStorage: storage(),
    history: { replaceState(_state, _title, path) { location.href = new URL(path, location).href; } },
  };
}

export function launchResponse(token = ticket()) {
  return Response.json({ enabled: true, launchUrl: `https://studio.test/script-master#host_token=${token}` });
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
