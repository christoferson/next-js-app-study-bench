/**
 * Server-side request forgery defence for source URL import
 * (`spec/SECURITY.md` section 4).
 *
 * The threat is specific and it is not hypothetical. This application fetches a URL that
 * arrives in a form field, from a server that — in production — sits inside a VPC with an
 * ECS task role and an instance metadata endpoint. A URL of
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` would hand the
 * response back to whoever submitted it. StudyBench is single-user, so the "whoever" is
 * the owner and the realistic risk is lower than for a public form — but the control
 * costs a hundred lines, the mistake costs credentials, and a redirect from a legitimate
 * documentation host to a private address is not something the owner can review by
 * looking at what they typed.
 *
 * Two ideas, and both are needed:
 *
 * 1. **Check the address, not the name.** A hostname is not a destination. `localhost`,
 *    `127.0.0.1.nip.io`, and a host whose A record was just changed to `10.0.0.1` all
 *    resolve into private space, and no amount of string matching on hostnames finds
 *    them all. So the guard resolves DNS and judges the resulting IP addresses, and it
 *    rejects if *any* resolved address is private — not merely the first — because
 *    which one a later `fetch` picks is not this code's decision.
 * 2. **Check every hop.** A redirect is a new URL that the owner never saw. Redirects
 *    are therefore followed manually, with the full check repeated on each `Location`,
 *    rather than delegated to `fetch`'s own `follow` mode, which would resolve and
 *    connect to a private address before this code ever saw it.
 *
 * This file is pure: it decides, and it explains its decision. It does not resolve DNS
 * itself — `HostResolver` is a port, so the tests exercise every rejected range without
 * a network and without hostnames that might one day stop resolving.
 */

/** Why a URL was refused. Stable identifiers; the message is for the owner. */
export type UrlRejectionReason =
  | "MALFORMED"
  | "UNSUPPORTED_SCHEME"
  | "CREDENTIALS_IN_URL"
  | "PRIVATE_ADDRESS"
  | "UNRESOLVABLE";

export interface UrlSafetyResult {
  readonly allowed: boolean;
  readonly reason?: UrlRejectionReason;
  /** Owner-facing explanation. Never contains a resolved address. */
  readonly message?: string;
}

/**
 * DNS, as a port.
 *
 * Returns every address the name resolves to, as strings. An empty array and a thrown
 * error are both "this name has no usable address"; the guard treats them the same way,
 * because a caller cannot act differently on them.
 */
export interface HostResolver {
  resolve(hostname: string): Promise<readonly string[]>;
}

const ALLOWED_PROTOCOLS = ["http:", "https:"] as const;

/**
 * Whether a URL may be fetched, given what its hostname resolves to.
 *
 * The order of checks is cheapest-and-most-decisive first, so a malformed or `file:`
 * URL never causes a DNS lookup.
 */
export async function checkUrlIsSafeToFetch(
  candidate: string,
  resolver: HostResolver,
): Promise<UrlSafetyResult> {
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return {
      allowed: false,
      reason: "MALFORMED",
      message: "That is not a valid web address.",
    };
  }

  if (!ALLOWED_PROTOCOLS.some((protocol) => protocol === url.protocol)) {
    return {
      allowed: false,
      reason: "UNSUPPORTED_SCHEME",
      // Naming the two allowed schemes rather than the rejected one, so the message is
      // the same whether the owner tried `file:`, `gopher:`, or `javascript:`.
      message: "Only http:// and https:// addresses can be imported.",
    };
  }

  if (url.username !== "" || url.password !== "") {
    // Credentials in a URL are both a leak — they would be stored as the source's
    // origin and shown on its page — and a classic parser-confusion trick, where
    // `https://trusted.example@10.0.0.1/` reads as one host and connects to another.
    return {
      allowed: false,
      reason: "CREDENTIALS_IN_URL",
      message:
        "Remove the username and password from the address before importing it.",
    };
  }

  // A literal IP address in the URL is judged directly: there is nothing to resolve, and
  // sending it to a resolver would be the one case where the answer could differ from
  // the address actually dialled.
  const literal = parseIpLiteral(url.hostname);

  if (literal !== null) {
    return isPrivateAddress(literal) ? privateRejection() : { allowed: true };
  }

  let addresses: readonly string[];

  try {
    addresses = await resolver.resolve(url.hostname);
  } catch {
    addresses = [];
  }

  if (addresses.length === 0) {
    return {
      allowed: false,
      reason: "UNRESOLVABLE",
      message: "That address could not be found. Check the spelling of the host.",
    };
  }

  // Every address, not the first: a name with one public and one private address must be
  // refused, because which one `fetch` connects to is chosen by the resolver order and
  // the operating system, not by this application.
  if (addresses.some((address) => isPrivateAddress(address))) {
    return privateRejection();
  }

  return { allowed: true };
}

/**
 * The rejection for anything that resolves inside the network.
 *
 * One message for every private range, and it names none of them. Telling the submitter
 * which range a host resolved into is free internal-network reconnaissance, and the
 * owner — who is the only submitter — does not need it to understand what happened.
 */
function privateRejection(): UrlSafetyResult {
  return {
    allowed: false,
    reason: "PRIVATE_ADDRESS",
    message:
      "That address points inside a private network, so it cannot be imported. Only public web addresses are allowed.",
  };
}

/** An IP literal as written in a URL host, or `null` when the host is a name. */
function parseIpLiteral(hostname: string): string | null {
  // A URL's IPv6 host is bracketed; `URL` keeps the brackets in `hostname`.
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return /^[0-9.]+$/.test(hostname) ? hostname : null;
}

/**
 * Whether one address is somewhere a source import must never reach.
 *
 * An allow-nothing-private list covering both families. IPv4-mapped IPv6
 * (`::ffff:10.0.0.1`) is unwrapped and re-checked as IPv4, because it is the same
 * destination written differently and it is the standard way to smuggle a v4 private
 * address past a v6-blind check.
 *
 * An address this function cannot parse is treated as private. That is the safe default:
 * the only inputs are a resolver's output and a URL literal, so an unparseable value
 * means the assumptions here are wrong, and refusing to fetch is the correct response to
 * that.
 */
export function isPrivateAddress(address: string): boolean {
  const trimmed = address.trim();
  // A resolver may report a scoped address (`fe80::1%eth0`); the zone is not part of
  // the address.
  const scopeless = trimmed.split("%")[0] ?? trimmed;

  if (scopeless.includes(":")) {
    return isPrivateIpv6(scopeless);
  }

  return isPrivateIpv4(scopeless);
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".");

  if (octets.length !== 4) {
    return true;
  }

  const numbers = octets.map((octet) =>
    /^\d{1,3}$/.test(octet) ? Number(octet) : Number.NaN,
  );

  if (numbers.some((number) => Number.isNaN(number) || number > 255)) {
    return true;
  }

  const [first = 0, second = 0] = numbers;

  return (
    first === 0 || // "this network", and 0.0.0.0 as a shorthand for localhost
    first === 10 || // 10/8 private
    first === 127 || // loopback
    (first === 169 && second === 254) || // link-local, which is where cloud metadata lives
    (first === 172 && second >= 16 && second <= 31) || // 172.16/12 private
    (first === 192 && second === 168) || // 192.168/16 private
    (first === 192 && second === 0) || // 192.0.0/24 protocol assignments, 192.0.2/24 TEST-NET
    (first === 100 && second >= 64 && second <= 127) || // 100.64/10 carrier NAT
    (first === 198 && (second === 18 || second === 19)) || // 198.18/15 benchmarking
    first >= 224 // multicast and reserved
  );
}

function isPrivateIpv6(address: string): boolean {
  const groups = expandIpv6(address);

  if (groups === null) {
    return true;
  }

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): the destination is a
  // v4 address, so the v4 rules are the ones that apply.
  const isMapped =
    groups.slice(0, 5).every((group) => group === 0) &&
    (groups[5] === 0xffff || groups[5] === 0);

  if (isMapped) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    const asIpv4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");

    // `::` and `::1` fall in here as 0.0.0.0 and 0.0.0.1, both of which the v4 rules
    // reject as "this network".
    return isPrivateIpv4(asIpv4);
  }

  const first = groups[0] ?? 0;

  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 || // ff00::/8 multicast
    first === 0x0100 || // 100::/64 discard-only
    first === 0x2001 // 2001::/23 protocol assignments: Teredo, ORCHID, documentation
  );
}

/**
 * An IPv6 address as its eight 16-bit groups, or `null` when it is not one.
 *
 * Written out rather than delegated to `node:net`, because this file is domain code with
 * no Node imports, and because `net.isIPv6` answers a different question — it validates,
 * it does not give back the numbers the range checks need.
 */
export function expandIpv6(address: string): readonly number[] | null {
  const halves = address.split("::");

  if (halves.length > 2) {
    return null;
  }

  const parseGroups = (part: string): readonly number[] | null => {
    if (part === "") {
      return [];
    }

    const groups: number[] = [];

    for (const [index, piece] of part.split(":").entries()) {
      // A trailing dotted-quad, as in ::ffff:192.168.0.1, is two groups.
      if (piece.includes(".")) {
        const octets = piece.split(".");

        if (octets.length !== 4 || index !== part.split(":").length - 1) {
          return null;
        }

        const numbers = octets.map((octet) =>
          /^\d{1,3}$/.test(octet) ? Number(octet) : Number.NaN,
        );

        if (numbers.some((number) => Number.isNaN(number) || number > 255)) {
          return null;
        }

        groups.push(((numbers[0] ?? 0) << 8) | (numbers[1] ?? 0));
        groups.push(((numbers[2] ?? 0) << 8) | (numbers[3] ?? 0));
        continue;
      }

      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) {
        return null;
      }

      groups.push(Number.parseInt(piece, 16));
    }

    return groups;
  };

  const head = parseGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];

  if (head === null || tail === null) {
    return null;
  }

  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }

  const missing = 8 - head.length - tail.length;

  if (missing < 1) {
    return null;
  }

  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}
