import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_IPV4_METADATA = new Set(["169.254.169.254", "100.100.100.200"]);

function parseIpv4(address: string) {
  return address.split(".").map((segment) => Number.parseInt(segment, 10));
}

function isPrivateIpv4(address: string) {
  const [a, b] = parseIpv4(address);
  if (a === 10) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  );
}

function assertSafeAddress(address: string) {
  const family = net.isIP(address);
  if (!family) {
    return;
  }

  if (family === 4) {
    if (BLOCKED_IPV4_METADATA.has(address) || isPrivateIpv4(address)) {
      throw new Error(`Blocked outbound address: ${address}`);
    }
    return;
  }

  if (isPrivateIpv6(address)) {
    throw new Error(`Blocked outbound address: ${address}`);
  }
}

function assertSafeHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith(".localhost")) {
    throw new Error(`Blocked outbound host: ${hostname}`);
  }
}

async function resolveHostname(hostname: string) {
  const addresses = await dns.lookup(hostname, {
    all: true,
    verbatim: true,
  });
  if (!addresses.length) {
    throw new Error(`Failed to resolve host: ${hostname}`);
  }
  for (const item of addresses) {
    assertSafeAddress(item.address);
  }
}

export async function assertSafeOutboundUrl(input: string | URL) {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Blocked outbound URL scheme: ${url.protocol}`);
  }

  assertSafeHostname(url.hostname);
  assertSafeAddress(url.hostname);
  if (!net.isIP(url.hostname)) {
    await resolveHostname(url.hostname);
  }

  return url;
}

export function resolveRedirectTarget(currentUrl: URL, location: string) {
  return new URL(location, currentUrl);
}
