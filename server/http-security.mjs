import { extname } from "node:path";

const SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function isAllowedBrowserOrigin(origin) {
  if (!origin) {
    return true;
  }
  try {
    const url = new URL(origin);
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function staticSecurityHeaders(filePath) {
  if (extname(filePath) === ".html") {
    return SECURITY_HEADERS;
  }
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}
