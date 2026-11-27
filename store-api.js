// WebOS — talks to the Store backend (/api/...). Cookies carry the sign-in; nothing is kept in JavaScript.
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code || '';
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api/' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-WebOS': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('You seem to be offline. The Store needs an internet connection.', 0, 'offline');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || !data) {
    if (!data) throw new ApiError('The Store is not available on this site yet.', res.status, 'unavailable');
    throw new ApiError(data.error || 'Something went wrong.', res.status, data.code);
  }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b || {});
export const del = (p) => api('DELETE', p);
