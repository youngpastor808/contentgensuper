import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Checks if a host is an IP address.
 */
function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

/**
 * Checks if the request is secure (HTTPS).
 * Considers X-Forwarded-Proto for requests behind proxies.
 */
function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

/**
 * Returns cookie options suitable for session management in an iframe context.
 * AI Studio preview runs in a cross-origin iframe, so SameSite=None and Secure=true are required.
 */
export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const hostname = req.hostname;
  
  // We generally don't want to set the domain for localhost or IP addresses
  const shouldSetDomain =
    hostname &&
    !LOCAL_HOSTS.has(hostname) &&
    !isIpAddress(hostname);

  const domain =
    shouldSetDomain && !hostname.startsWith(".")
      ? `.${hostname}`
      : shouldSetDomain
        ? hostname
        : undefined;

  const isElectron = process.env.ELECTRON === '1';
  const isSecure = isElectron ? false : (isSecureRequest(req) || process.env.NODE_ENV === "production");

  return {
    domain,
    httpOnly: true,
    path: "/",
    sameSite: isElectron ? "lax" : "none",
    secure: isSecure,
    ...(isSecure && !isElectron ? { partitioned: true } : {}),
  } as any;
}
