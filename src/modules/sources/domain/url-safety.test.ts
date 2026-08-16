import { describe, expect, it } from "vitest";
import { FakeHostResolver } from "@/modules/sources/infrastructure/test-support";
import type { HostResolver, UrlSafetyResult } from "./url-safety";
import {
  checkUrlIsSafeToFetch,
  expandIpv6,
  isPrivateAddress,
} from "./url-safety";

/**
 * The SSRF guard (`spec/SECURITY.md` section 4).
 *
 * Each rejection is a range that a source import must never reach, and the tests reach
 * them through the resolver port rather than through hostnames, so no case here depends on
 * a name still resolving the way it did when the test was written. `FakeHostResolver`
 * resolves an unlisted name to a public address, which is why every rejection below has to
 * name its own addresses.
 */

const PUBLIC_URL = "https://docs.example.test/guide";

/** Resolves `docs.example.test` to whatever the case is about. */
function resolverFor(...addresses: readonly string[]): FakeHostResolver {
  return new FakeHostResolver({ "docs.example.test": addresses });
}

async function check(
  url: string,
  resolver: HostResolver = new FakeHostResolver(),
): Promise<UrlSafetyResult> {
  return checkUrlIsSafeToFetch(url, resolver);
}

describe("an allowed URL", () => {
  it("allows an https URL resolving to a public address", async () => {
    const result = await check(PUBLIC_URL, resolverFor("93.184.216.34"));

    expect(result).toEqual({ allowed: true });
  });

  it("allows an http URL", async () => {
    expect(await check("http://docs.example.test/guide")).toEqual({
      allowed: true,
    });
  });

  it("allows a name with several public addresses", async () => {
    const result = await check(
      PUBLIC_URL,
      resolverFor("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"),
    );

    expect(result.allowed).toBe(true);
  });

  it("returns no reason or message when it allows a URL", async () => {
    const result = await check(PUBLIC_URL);

    expect(result.reason).toBeUndefined();
    expect(result.message).toBeUndefined();
  });
});

describe("MALFORMED", () => {
  it.each([
    "not a url",
    "",
    "   ",
    "http://",
    "https://",
    "://example.test",
    "//example.test/guide",
  ])("rejects %o as malformed", async (candidate) => {
    const resolver = new FakeHostResolver();
    const result = await check(candidate, resolver);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MALFORMED");
    expect(result.message).toBe("That is not a valid web address.");
    // Cheapest check first: nothing was resolved.
    expect(resolver.lookups).toEqual([]);
  });
});

describe("UNSUPPORTED_SCHEME", () => {
  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "gopher://docs.example.test/1",
    "ftp://docs.example.test/file.txt",
    "data:text/plain,hello",
    "ws://docs.example.test/socket",
  ])("rejects %o", async (candidate) => {
    const resolver = new FakeHostResolver();
    const result = await check(candidate, resolver);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("UNSUPPORTED_SCHEME");
    expect(resolver.lookups).toEqual([]);
  });

  it("names the two allowed schemes rather than the rejected one", async () => {
    const message = "Only http:// and https:// addresses can be imported.";

    expect((await check("file:///etc/passwd")).message).toBe(message);
    expect((await check("javascript:alert(1)")).message).toBe(message);
    expect((await check("gopher://docs.example.test/1")).message).toBe(message);
  });
});

describe("CREDENTIALS_IN_URL", () => {
  it.each([
    "https://owner:secret@docs.example.test/guide",
    "https://owner@docs.example.test/guide",
    "https://:secret@docs.example.test/guide",
  ])("rejects %o", async (candidate) => {
    const resolver = new FakeHostResolver();
    const result = await check(candidate, resolver);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("CREDENTIALS_IN_URL");
    expect(result.message).toBe(
      "Remove the username and password from the address before importing it.",
    );
    expect(resolver.lookups).toEqual([]);
  });

  it("rejects the parser-confusion form before judging the host", async () => {
    // `https://trusted.example@10.0.0.1/` reads as one host and connects to another.
    const result = await check("https://docs.example.test@10.0.0.1/guide");

    expect(result.reason).toBe("CREDENTIALS_IN_URL");
  });

  it("never leaks the credentials back in the message", async () => {
    const result = await check("https://owner:secret@docs.example.test/guide");

    expect(result.message).not.toContain("secret");
    expect(result.message).not.toContain("owner");
  });
});

describe("UNRESOLVABLE", () => {
  it("rejects a name that resolves to no addresses", async () => {
    const result = await check(PUBLIC_URL, resolverFor());

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("UNRESOLVABLE");
    expect(result.message).toBe(
      "That address could not be found. Check the spelling of the host.",
    );
  });

  it("rejects a name whose resolution throws", async () => {
    // A thrown error and an empty answer are the same fact, and a caller cannot act
    // differently on them.
    const throwing: HostResolver = {
      async resolve() {
        throw new Error("ENOTFOUND");
      },
    };
    const result = await check(PUBLIC_URL, throwing);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("UNRESOLVABLE");
  });

  it("does not let a resolver failure become an allowed fetch", async () => {
    const rejecting: HostResolver = {
      resolve: () => Promise.reject(new Error("timeout")),
    };

    expect((await check(PUBLIC_URL, rejecting)).allowed).toBe(false);
  });
});

describe("PRIVATE_ADDRESS by resolved IPv4 range", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["10.0.0.1", "10/8 private"],
    ["172.16.0.1", "the bottom of 172.16/12"],
    ["172.31.255.255", "the top of 172.16/12"],
    ["192.168.1.1", "192.168/16 private"],
    ["169.254.169.254", "the cloud metadata endpoint"],
    ["100.64.0.1", "carrier NAT"],
    ["0.0.0.0", "this network"],
  ])("rejects a name resolving to %s (%s)", async (address) => {
    const result = await check(PUBLIC_URL, resolverFor(address));

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("PRIVATE_ADDRESS");
  });

  it.each(["172.15.0.1", "172.32.0.1", "172.15.255.255", "172.32.255.255"])(
    "allows %s, which is outside 172.16/12",
    async (address) => {
      expect((await check(PUBLIC_URL, resolverFor(address))).allowed).toBe(
        true,
      );
    },
  );

  it("gives one message that names no range", async () => {
    const result = await check(PUBLIC_URL, resolverFor("169.254.169.254"));

    expect(result.message).toBe(
      "That address points inside a private network, so it cannot be imported. Only public web addresses are allowed.",
    );
    expect(result.message).not.toContain("169");
    expect(result.message).not.toContain("metadata");
  });

  it("gives the same message for every private range", async () => {
    const messages = new Set<string | undefined>();

    for (const address of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "::1"]) {
      messages.add((await check(PUBLIC_URL, resolverFor(address))).message);
    }

    expect(messages.size).toBe(1);
  });
});

describe("PRIVATE_ADDRESS by resolved IPv6 range", () => {
  it.each([
    ["::1", "loopback"],
    ["fc00::1", "unique local"],
    ["fd00::1", "unique local"],
    ["fe80::1", "link-local"],
    ["ff02::1", "multicast"],
    ["::ffff:10.0.0.1", "IPv4-mapped private"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
  ])("rejects a name resolving to %s (%s)", async (address) => {
    const result = await check(PUBLIC_URL, resolverFor(address));

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("PRIVATE_ADDRESS");
  });

  it("rejects a scoped link-local address, zone and all", async () => {
    const result = await check(PUBLIC_URL, resolverFor("fe80::1%eth0"));

    expect(result.reason).toBe("PRIVATE_ADDRESS");
  });

  it("allows a public IPv6 address", async () => {
    const result = await check(
      PUBLIC_URL,
      resolverFor("2606:2800:220:1:248:1893:25c8:1946"),
    );

    expect(result.allowed).toBe(true);
  });
});

describe("every resolved address is judged", () => {
  it("rejects a name resolving to both a public and a private address", async () => {
    // Which one `fetch` connects to is chosen by resolver order and the operating
    // system, not by this application.
    const result = await check(
      PUBLIC_URL,
      resolverFor("93.184.216.34", "10.0.0.5"),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("PRIVATE_ADDRESS");
  });

  it("rejects it whichever order the addresses arrive in", async () => {
    const result = await check(
      PUBLIC_URL,
      resolverFor("10.0.0.5", "93.184.216.34"),
    );

    expect(result.reason).toBe("PRIVATE_ADDRESS");
  });

  it("rejects a name whose only private address is the last of many", async () => {
    const result = await check(
      PUBLIC_URL,
      resolverFor("93.184.216.34", "23.0.0.1", "8.8.8.8", "169.254.169.254"),
    );

    expect(result.reason).toBe("PRIVATE_ADDRESS");
  });

  it("looks the hostname up exactly once", async () => {
    const resolver = resolverFor("93.184.216.34");

    await checkUrlIsSafeToFetch(PUBLIC_URL, resolver);

    expect(resolver.lookups).toEqual(["docs.example.test"]);
  });

  it("resolves the hostname without the port or the path", async () => {
    const resolver = resolverFor("93.184.216.34");

    await checkUrlIsSafeToFetch(
      "https://docs.example.test:8443/a/b?c=d#e",
      resolver,
    );

    expect(resolver.lookups).toEqual(["docs.example.test"]);
  });
});

describe("an IP literal in the URL host", () => {
  it("judges a private IPv4 literal without a DNS lookup", async () => {
    // Sending a literal to a resolver would be the one case where the answer could
    // differ from the address actually dialled.
    const resolver = new FakeHostResolver();
    const result = await check("http://10.0.0.1/admin", resolver);

    expect(result.reason).toBe("PRIVATE_ADDRESS");
    expect(resolver.lookups).toEqual([]);
  });

  it("judges the metadata endpoint without a DNS lookup", async () => {
    const resolver = new FakeHostResolver();
    const result = await check(
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      resolver,
    );

    expect(result.reason).toBe("PRIVATE_ADDRESS");
    expect(resolver.lookups).toEqual([]);
  });

  it("judges a public IPv4 literal without a DNS lookup", async () => {
    const resolver = new FakeHostResolver();
    const result = await check("http://93.184.216.34/guide", resolver);

    expect(result.allowed).toBe(true);
    expect(resolver.lookups).toEqual([]);
  });

  it("judges a bracketed IPv6 literal host", async () => {
    const resolver = new FakeHostResolver();

    expect((await check("http://[::1]/admin", resolver)).reason).toBe(
      "PRIVATE_ADDRESS",
    );
    expect((await check("http://[fd00::1]/admin", resolver)).reason).toBe(
      "PRIVATE_ADDRESS",
    );
    expect(resolver.lookups).toEqual([]);
  });

  it("allows a bracketed public IPv6 literal host", async () => {
    const resolver = new FakeHostResolver();
    const result = await check(
      "https://[2606:2800:220:1:248:1893:25c8:1946]/guide",
      resolver,
    );

    expect(result.allowed).toBe(true);
    expect(resolver.lookups).toEqual([]);
  });

  it("rejects an IPv4-mapped literal host", async () => {
    // `URL` rewrites the host to `[::ffff:a00:1]`, and the guard unwraps it to 10.0.0.1.
    const resolver = new FakeHostResolver();
    const result = await check("http://[::ffff:10.0.0.1]/admin", resolver);

    expect(result.reason).toBe("PRIVATE_ADDRESS");
    expect(resolver.lookups).toEqual([]);
  });

  it("rejects the decimal and octal spellings of loopback", async () => {
    // `URL` normalises these to 127.0.0.1 before the guard ever sees them, which is
    // exactly why the check reads the parsed hostname rather than the submitted string.
    const resolver = new FakeHostResolver();

    expect((await check("http://2130706433/", resolver)).reason).toBe(
      "PRIVATE_ADDRESS",
    );
    expect((await check("http://0177.0.0.1/", resolver)).reason).toBe(
      "PRIVATE_ADDRESS",
    );
    expect((await check("http://127.1/", resolver)).reason).toBe(
      "PRIVATE_ADDRESS",
    );
    expect(resolver.lookups).toEqual([]);
  });

  it("resolves a name that merely looks like a private address", async () => {
    // `127.0.0.1.nip.io` is a name, so it goes to the resolver — and the resolver's
    // answer is what gets judged.
    const resolver = new FakeHostResolver({
      "127.0.0.1.nip.io": ["127.0.0.1"],
    });
    const result = await check("http://127.0.0.1.nip.io/admin", resolver);

    expect(result.reason).toBe("PRIVATE_ADDRESS");
    expect(resolver.lookups).toEqual(["127.0.0.1.nip.io"]);
  });

  it("resolves localhost rather than string-matching it", async () => {
    const resolver = new FakeHostResolver({ localhost: ["127.0.0.1"] });

    expect((await check("http://localhost:3000/", resolver)).reason).toBe(
      "PRIVATE_ADDRESS",
    );
    expect(resolver.lookups).toEqual(["localhost"]);
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.255.255.255",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.169.254",
    "172.16.0.0",
    "172.31.255.255",
    "192.168.0.0",
    "192.0.0.1",
    "192.0.2.1",
    "100.64.0.1",
    "100.127.255.255",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "239.255.255.255",
    "255.255.255.255",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "172.15.255.255",
    "172.32.0.0",
    "192.167.1.1",
    "192.169.1.1",
    "100.63.255.255",
    "100.128.0.1",
    "198.17.255.255",
    "198.20.0.1",
    "223.255.255.255",
  ])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("treats an unparseable address as private", () => {
    // The safe default: the only inputs are a resolver's output and a URL literal, so an
    // unparseable value means the assumptions here are wrong.
    for (const address of [
      "",
      "not-an-address",
      "1.2.3",
      "1.2.3.4.5",
      "1.2.3.999",
      "1.2.3.-4",
      "1.2.3.0x4",
      "abc.def.ghi.jkl",
      "fizz::buzz",
      "::gggg",
      "1::2::3",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it("ignores surrounding whitespace", () => {
    expect(isPrivateAddress("  10.0.0.1  ")).toBe(true);
    expect(isPrivateAddress("  93.184.216.34  ")).toBe(false);
  });

  it("strips an IPv6 zone before judging", () => {
    expect(isPrivateAddress("fe80::1%eth0")).toBe(true);
    expect(isPrivateAddress("2606:2800::1%eth0")).toBe(false);
  });

  it.each([
    "::",
    "::1",
    "fc00::",
    "fdff:ffff::1",
    "fe80::1",
    "febf::1",
    "ff00::1",
    "ff02::1",
    "100::1",
    "2001::1",
    "2001:db8::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::10.0.0.1",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "2606:2800:220:1:248:1893:25c8:1946",
    "2a00::1",
    "fec0::1",
    "3fff::1",
    "::ffff:93.184.216.34",
  ])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("expandIpv6", () => {
  it("expands a fully written address into eight groups", () => {
    expect(expandIpv6("2001:0db8:0000:0000:0000:0000:0000:0001")).toEqual([
      0x2001, 0x0db8, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it("expands a compressed address, filling the gap with zeroes", () => {
    expect(expandIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(expandIpv6("fe80::1")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6("2001:db8::1:2")).toEqual([
      0x2001, 0x0db8, 0, 0, 0, 0, 1, 2,
    ]);
  });

  it("reads a trailing dotted quad as two groups", () => {
    expect(expandIpv6("::ffff:10.0.0.1")).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0001,
    ]);
    expect(expandIpv6("::ffff:127.0.0.1")).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001,
    ]);
  });

  it("is case insensitive about hexadecimal digits", () => {
    expect(expandIpv6("FE80::AB")).toEqual(expandIpv6("fe80::ab"));
  });

  it("returns null for an address with too few groups and no compression", () => {
    expect(expandIpv6("2001:db8:0:0:0:0:1")).toBeNull();
  });

  it("returns null for an address with too many groups", () => {
    expect(expandIpv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(expandIpv6("1:2:3:4:5:6:7:8::9")).toBeNull();
  });

  it("returns null for more than one compression point", () => {
    expect(expandIpv6("1::2::3")).toBeNull();
  });

  it("returns null for a group that is not hexadecimal", () => {
    expect(expandIpv6("gggg::1")).toBeNull();
    expect(expandIpv6("12345::1")).toBeNull();
    expect(expandIpv6("")).toBeNull();
  });

  it("returns null for a malformed or misplaced dotted quad", () => {
    expect(expandIpv6("::ffff:1.2.3")).toBeNull();
    expect(expandIpv6("::ffff:1.2.3.999")).toBeNull();
    expect(expandIpv6("::1.2.3.4:ffff")).toBeNull();
  });
});
