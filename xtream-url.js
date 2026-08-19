// Xtream Codes panels expose the same catalogue twice: as a generated M3U at
// /get.php, and as JSON at /player_api.php. The JSON is far cheaper to fetch,
// so we detect the M3U form and reach for the API instead.

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null; // not a url at all — caller falls back to the M3U path
  }
}

function isXtreamUrl(url) {
  const u = parse(url);
  if (!u) return false;
  return u.pathname.endsWith('/get.php')
    && u.searchParams.has('username')
    && u.searchParams.has('password');
}

function xtreamCreds(url) {
  if (!isXtreamUrl(url)) return null;
  const u = parse(url);
  return {
    origin: u.origin,
    username: u.searchParams.get('username'),
    password: u.searchParams.get('password'),
  };
}

function xtreamApiUrl(creds, params) {
  const u = new URL(`${creds.origin}/player_api.php`);
  u.searchParams.set('username', creds.username);
  u.searchParams.set('password', creds.password);
  for (const [key, value] of Object.entries(params)) {
    u.searchParams.set(key, String(value));
  }
  return u.href;
}

module.exports = { isXtreamUrl, xtreamCreds, xtreamApiUrl };
