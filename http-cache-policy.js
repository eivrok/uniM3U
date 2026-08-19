// Conditional-request headers built from whatever the previous response gave
// us. A server that honours either validator can answer 304 and skip the whole
// transfer, which on a large playlist is the entire cost of a refresh.
function conditionalHeaders(validators) {
  if (!validators) return {};
  const headers = {};
  if (validators.etag) headers['If-None-Match'] = validators.etag;
  if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified;
  return headers;
}

module.exports = { conditionalHeaders };
