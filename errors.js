// Carries a stable machine-readable `code` alongside the technical `message` (kept for
// server-side logs only) so the UI layer can map failures to a translated, human-readable
// sentence instead of ever showing a raw HTTP/JSON error to a PM.
class AppError extends Error {
  constructor(code, message, vars) {
    super(message);
    this.code = code;
    this.vars = vars || {};
  }
}

function httpErrorCode(service, status) {
  if (status === 404) return `${service}_not_found`;
  if (status === 401 || status === 403) return `${service}_forbidden`;
  if (status >= 500) return `${service}_unavailable`;
  return `${service}_http_error`;
}

module.exports = { AppError, httpErrorCode };
