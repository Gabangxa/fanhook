/**
 * lib/ssrf.js
 *
 * SSRF guard for user-supplied destination URLs.
 *
 * Destination hostnames are DNS-resolved and every resulting address is
 * checked against loopback, private, link-local (cloud metadata), and other
 * reserved ranges. The check runs at route-creation time AND again immediately
 * before delivery (see lib/fanout.js) so a DNS-rebinding attack — where a
 * hostname resolves publicly at creation and privately at delivery — is also
 * defeated.
 *
 * Escape hatch for local development / test suites, read at CALL time:
 *   FANHOOK_ALLOW_PRIVATE_DESTINATIONS=loopback  → allow 127.0.0.0/8 and ::1
 *                                                  only (used by the dev
 *                                                  server so test targets on
 *                                                  127.0.0.1 keep working,
 *                                                  while 10/8, 192.168/16,
 *                                                  169.254.169.254 etc. stay
 *                                                  blocked)
 *   FANHOOK_ALLOW_PRIVATE_DESTINATIONS=all|1|true → disable the guard entirely
 */

const dnsPromises = require('dns').promises;
const net = require('net');

function policyFromEnv() {
  const raw = String(process.env.FANHOOK_ALLOW_PRIVATE_DESTINATIONS || '').trim().toLowerCase();
  if (raw === 'all' || raw === '1' || raw === 'true') return 'all';
  if (raw === 'loopback') return 'loopback';
  return 'none';
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr4(ipInt, base, maskBits) {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (ipv4ToInt(base) & mask);
}

// Returns 'loopback' | 'blocked' | 'public'
function classifyIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (inCidr4(n, '127.0.0.0', 8)) return 'loopback';
  const blocked = [
    ['0.0.0.0', 8],        // "this network"
    ['10.0.0.0', 8],       // private
    ['100.64.0.0', 10],    // carrier-grade NAT
    ['169.254.0.0', 16],   // link-local incl. 169.254.169.254 metadata
    ['172.16.0.0', 12],    // private
    ['192.0.0.0', 24],     // IETF protocol assignments
    ['192.0.2.0', 24],     // TEST-NET-1
    ['192.168.0.0', 16],   // private
    ['198.18.0.0', 15],    // benchmarking
    ['198.51.100.0', 24],  // TEST-NET-2
    ['203.0.113.0', 24],   // TEST-NET-3
    ['224.0.0.0', 4],      // multicast
    ['240.0.0.0', 4],      // reserved + broadcast
  ];
  for (const [base, bits] of blocked) {
    if (inCidr4(n, base, bits)) return 'blocked';
  }
  return 'public';
}

// Expand an IPv6 address into 8 numeric hextets (handles ::)
function expandIPv6(ip) {
  // Strip zone index (fe80::1%eth0)
  const clean = ip.split('%')[0];
  let head = clean;
  let tail = '';
  if (clean.includes('::')) {
    const [h, t] = clean.split('::');
    head = h;
    tail = t;
  }
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];

  // Embedded IPv4 at the end (e.g. ::ffff:127.0.0.1)
  let v4 = null;
  const last = tailParts.length ? tailParts[tailParts.length - 1] : (headParts.length ? headParts[headParts.length - 1] : '');
  if (last.includes('.')) {
    v4 = last;
    const n = ipv4ToInt(last);
    const asHex = [(n >>> 16) & 0xffff, n & 0xffff];
    if (tailParts.length) {
      tailParts.splice(tailParts.length - 1, 1, ...asHex.map((x) => x.toString(16)));
    } else {
      headParts.splice(headParts.length - 1, 1, ...asHex.map((x) => x.toString(16)));
    }
  }

  const missing = 8 - headParts.length - tailParts.length;
  const groups = [
    ...headParts,
    ...Array(Math.max(0, missing)).fill('0'),
    ...tailParts,
  ].map((g) => parseInt(g, 16) || 0);
  return { groups, v4 };
}

// Returns 'loopback' | 'blocked' | 'public'
function classifyIPv6(ip) {
  const { groups, v4 } = expandIPv6(ip);
  const isZero = groups.every((g) => g === 0);
  if (isZero) return 'blocked'; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return 'loopback'; // ::1

  // IPv4-mapped (::ffff:x.x.x.x) — classify the embedded IPv4 address
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    if (v4) return classifyIPv4(v4);
    const embedded = `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
    return classifyIPv4(embedded);
  }

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return 'blocked'; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return 'blocked'; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return 'blocked'; // fec0::/10 deprecated site-local
  if ((first & 0xff00) === 0xff00) return 'blocked'; // ff00::/8 multicast
  if (first === 0x0064 && groups[1] === 0xff9b) return 'blocked'; // 64:ff9b::/96 NAT64
  return 'public';
}

// Returns 'loopback' | 'blocked' | 'public'
function classifyAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return classifyIPv4(ip);
  if (family === 6) return classifyIPv6(ip);
  return 'blocked';
}

function isAllowedByPolicy(classification, policy) {
  if (policy === 'all') return true;
  if (classification === 'public') return true;
  if (classification === 'loopback' && policy === 'loopback') return true;
  return false;
}

class SsrfBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfBlockedError';
    this.code = 'SSRF_BLOCKED';
  }
}

/**
 * Validate a destination URL. Resolves the hostname (unless it is a literal
 * IP) and asserts every resolved address is allowed under the active policy.
 *
 * @param {string} url - destination URL (http/https)
 * @param {object} [opts]
 * @param {'none'|'loopback'|'all'} [opts.policy] - override; defaults to the
 *   FANHOOK_ALLOW_PRIVATE_DESTINATIONS env var, read at call time
 * @throws {SsrfBlockedError} when the destination is not allowed
 * @throws {Error} when the URL is malformed or DNS resolution fails
 */
async function assertPublicDestination(url, opts = {}) {
  const policy = opts.policy || policyFromEnv();
  if (policy === 'all') return;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw new SsrfBlockedError('destination is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError('destination must use http or https');
  }

  // Hostname from URL; strip brackets from IPv6 literals
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    let records;
    try {
      records = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
    } catch (err) {
      throw new SsrfBlockedError(`destination hostname could not be resolved (${err.code || err.message})`);
    }
    if (!records || records.length === 0) {
      throw new SsrfBlockedError('destination hostname resolved to no addresses');
    }
    addresses = records.map((r) => r.address);
  }

  for (const addr of addresses) {
    const classification = classifyAddress(addr);
    if (!isAllowedByPolicy(classification, policy)) {
      throw new SsrfBlockedError(
        `destination resolves to a ${classification === 'loopback' ? 'loopback' : 'private/reserved'} address (${addr}) which is not allowed`
      );
    }
  }
}

/**
 * Build a `lookup` function (net/dns signature) that enforces the SSRF policy
 * at socket-connect time. Passing this to an http/https Agent means the
 * address the socket actually connects to is the one that was validated —
 * closing the TOCTOU window where a hostname re-resolves to a private IP
 * between a pre-check and the outbound connection (DNS rebinding).
 *
 * Strict: if ANY resolved address is disallowed, the whole connection is
 * refused (same rule as assertPublicDestination).
 *
 * @param {'none'|'loopback'|'all'} [policyOverride] - defaults to env, read at call time
 */
function makeSafeLookup(policyOverride) {
  const dns = require('dns');
  return function safeLookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const policy = policyOverride || policyFromEnv();
    if (policy === 'all') {
      return dns.lookup(hostname, options, callback);
    }
    dnsPromises.lookup(hostname, { all: true, verbatim: true })
      .then((records) => {
        if (!records || records.length === 0) {
          return callback(new SsrfBlockedError(`destination ${hostname} resolved to no addresses`));
        }
        for (const r of records) {
          const classification = classifyAddress(r.address);
          if (!isAllowedByPolicy(classification, policy)) {
            return callback(new SsrfBlockedError(
              `destination ${hostname} resolves to a ${classification === 'loopback' ? 'loopback' : 'private/reserved'} address (${r.address}) which is not allowed`
            ));
          }
        }
        if (options && options.all) {
          return callback(null, records);
        }
        return callback(null, records[0].address, records[0].family);
      })
      .catch((err) => callback(err));
  };
}

module.exports = {
  assertPublicDestination,
  classifyAddress,
  policyFromEnv,
  makeSafeLookup,
  SsrfBlockedError,
};
