// Xtream Codes carries subscription credentials in the stream URL itself —
// as path segments (/<user>/<pass>/<id>) or query parameters (get.php,
// player_api.php). Anything that logs a stream URL therefore logs a working
// login, so every URL goes through here before it reaches the console.
const SECRET_PARAMS = new Set(['username', 'password', 'user', 'pass', 'token']);

// Path prefixes an Xtream panel puts ahead of the credentials. Keeping them
// makes a redacted log still say what kind of stream failed.
const CATEGORIES = new Set(['live', 'movie', 'series']);

const MASK = '***';

export function redactUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    // Never echo back something we could not parse — it may still be a URL
    // with credentials in it, just one the URL parser rejected.
    return '<unparseable url>';
  }

  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_PARAMS.has(key.toLowerCase())) url.searchParams.set(key, MASK);
  }

  const segments = url.pathname.split('/').filter(Boolean);
  // Fewer than three segments cannot be the /<user>/<pass>/<id> form. Above
  // that, mask everything between the category and the stream id rather than
  // trying to recognise a credential — over-redacting a log line costs nothing.
  if (segments.length >= 3) {
    const masked = segments.map((segment, i) => {
      if (i === segments.length - 1) return segment;
      if (i === 0 && CATEGORIES.has(segment.toLowerCase())) return segment;
      return MASK;
    });
    url.pathname = `/${masked.join('/')}`;
  }

  return url.href;
}
