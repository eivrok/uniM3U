class InsecureRedirectError extends Error {}

// Playlist and Xtream urls carry the user's credentials in the query string,
// so following an https url to plain http would send them in clear text.
// Upgrades are fine, and so is http to http: that url was never protected.
// Messages name only the schemes, never the urls, because they reach the
// renderer and its console.
function redirectTarget(fromUrl, location) {
  const target = new URL(location, fromUrl);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new InsecureRedirectError(`Refused redirect to a ${target.protocol} url`);
  }
  if (new URL(fromUrl).protocol === 'https:' && target.protocol === 'http:') {
    throw new InsecureRedirectError('Refused redirect from https to http');
  }
  return target.href;
}

module.exports = { redirectTarget, InsecureRedirectError };
