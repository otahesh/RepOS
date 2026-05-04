// Dev-only fetch shim: when `localStorage.repos_dev_token` is set, prepend
// `Authorization: Bearer <token>` to every /api/* request. Lets us drive the
// authenticated routes from a browser without CF Access running locally.
//
// Only imported from main.tsx behind `import.meta.env.DEV`, so the body is
// dead-stripped in production builds — it never ships to repos.jpmtech.com.
// Hostname is also gated as defense-in-depth in case someone copies a built
// artifact onto an unexpected origin.

if (import.meta.env.DEV) {
  const isLocal =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';
  const token = isLocal ? localStorage.getItem('repos_dev_token') : null;
  if (token) {
    const orig = window.fetch.bind(window);
    window.fetch = (input, init) => {
      let url: string;
      try {
        url = typeof input === 'string' ? input : (input as Request).url;
      } catch {
        url = '';
      }
      if (typeof url === 'string' && url.includes('/api/')) {
        const headers = new Headers(
          (init && init.headers) ||
            (input instanceof Request ? input.headers : undefined) ||
            {},
        );
        headers.set('Authorization', `Bearer ${token}`);
        init = { ...(init || {}), headers };
      }
      return orig(input, init);
    };
  }
}
