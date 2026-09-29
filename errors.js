// Carries a stable machine-readable `code` alongside the technical `message` (kept for
// server-side logs only) so the UI layer can map failures to a translated, human-readable
// sentence instead of ever showing a raw HTTP/JSON error to a PM. `vars` fills that sentence's
// {{placeholders}} (which page, which epic, which box...) so it can say exactly what went wrong
// and what to do about it, not just which service failed.
class AppError extends Error {
  constructor(code, message, vars) {
    super(message);
    this.code = code;
    this.vars = vars || {};
  }
  // The service a code belongs to (its prefix) — drives the banner's "Jira / Confluence /
  // BigPicture" label, so a Jira failure is never announced as a Confluence one.
  get source() {
    const prefix = this.code.split('_')[0];
    return ['jira', 'confluence', 'bigpicture'].includes(prefix) ? prefix : 'app';
  }
}

// Maps a failed HTTP response to the most specific code we can tell apart from the status alone.
// Each service module refines this further where its own API gives more signal (see jira.js's and
// confluence.js's fetch helpers) — e.g. an expired token doesn't always come back as a 401.
function httpErrorCode(service, status) {
  if (status === 401) return `${service}_token_invalid`;
  if (status === 403) return `${service}_forbidden`;
  if (status === 404) return `${service}_not_found`;
  if (status === 429) return `${service}_rate_limited`;
  if (status >= 500) return `${service}_unavailable`;
  return `${service}_http_error`;
}

// A fetch that never got a response: node-fetch's own timeout vs. anything else (DNS, refused,
// reset). Told apart because "slow" and "unreachable" call for different reactions.
function networkErrorCode(service, err) {
  return err && err.type === 'request-timeout' ? `${service}_timeout` : `${service}_unreachable`;
}

module.exports = { AppError, httpErrorCode, networkErrorCode };
