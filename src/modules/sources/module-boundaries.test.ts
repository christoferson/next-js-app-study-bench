import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dependency-direction checks for the source library.
 *
 * The direction that matters most here is the one the next slice will be tempted to
 * reverse. Sources are a store of trusted text; `ai-generation` is what writes questions
 * from it. Grounding therefore means generation reading sources, never sources knowing
 * that a model exists — a source is a document the owner trusts whether or not anything is
 * ever generated from it, and an import that reached into `ai-generation` would make the
 * whole library depend on a Bedrock client being configured.
 *
 * The scan mirrors `audio/module-boundaries.test.ts` and
 * `ai-generation/module-boundaries.test.ts` deliberately: same technique, same literal
 * matching on `from "..."` specifiers, so a reader who has seen one has seen all three.
 */

const MODULES = join(process.cwd(), "src", "modules");

/** Every `.ts` and `.tsx` file under one directory, recursively. */
function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
      ? [path]
      : [];
  });
}

/** Import specifiers, in the form they are written. */
function importSpecifiers(file: string): readonly string[] {
  const text = readFileSync(file, "utf8");

  return [...text.matchAll(/from\s+"([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Files in `moduleName` whose imports mention `forbidden`. */
function offenders(moduleName: string, forbidden: string): readonly string[] {
  return sourceFiles(join(MODULES, moduleName))
    .filter((file) =>
      importSpecifiers(file).some((specifier) => specifier.includes(forbidden)),
    )
    .map((file) => relative(process.cwd(), file).split(sep).join("/"));
}

describe("module dependency direction", () => {
  it("keeps sources unaware of ai-generation", () => {
    // The one that guards slice 2. Grounded generation is generation reading sources;
    // an import in this direction would mean the source library could not be used —
    // or tested — without a model gateway.
    expect(offenders("sources", "modules/ai-generation")).toEqual([]);
  });

  it("keeps sources unaware of the question bank and flashcards", () => {
    // A source is a document, not study material. What was written from it is recorded
    // by whatever wrote it, and the reverse direction would make a source's page depend
    // on every bank that might cite it.
    expect(offenders("sources", "modules/question-bank")).toEqual([]);
    expect(offenders("sources", "modules/flashcards")).toEqual([]);
  });

  it("keeps sources unaware of study sessions and audio", () => {
    expect(offenders("sources", "modules/study-sessions")).toEqual([]);
    expect(offenders("sources", "modules/audio")).toEqual([]);
  });

  it("keeps certifications unaware of sources", () => {
    // Sources hang off a track. A track knowing which documents were imported for it
    // would put the source library into the study model that predates it.
    expect(offenders("certifications", "modules/sources")).toEqual([]);
  });
});

describe("sources internal boundaries", () => {
  function sourcesFiles(...segments: readonly string[]): readonly string[] {
    return sourceFiles(join(MODULES, "sources", ...segments));
  }

  it("keeps `fetch` and DNS inside the one adapter that owns them", () => {
    // The reason `UrlRetriever` is a port: the default test suite must never reach the
    // network (`spec/TESTING.md` section 5). Only the fetch adapter and its own test may
    // name `node:dns` or call `fetch` — the domain guard decides, and it is handed
    // resolved addresses rather than resolving them.
    // Shipped files only. A test naming `node:dns` would be a test of the resolver
    // adapter, which is allowed; what must not exist is a second *product* file that
    // resolves a name, because then there would be two places the guard could be
    // bypassed.
    const importers = sourcesFiles()
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) =>
        importSpecifiers(file).some((specifier) =>
          specifier.startsWith("node:dns"),
        ),
      )
      .map((file) => file.split(sep).at(-1));

    expect([...importers].sort()).toEqual(["fetch-url-retriever.ts"]);
  });

  it("calls fetch only from the retriever adapter", () => {
    // Shipped files only, for the same reason as the check above, and for one more: a
    // test's *fixture text* may legitimately contain the characters `fetch(` without
    // calling anything. `html-to-text.test.ts` asserts that an `onerror="fetch('/steal')"`
    // attribute does not survive an import, and the attacker's payload has to be written
    // down somewhere for that to be tested at all.
    const callers = sourcesFiles()
      .filter(
        (file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
      )
      .filter((file) => /(?<![.\w])fetch\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.split(sep).at(-1) ?? "");

    expect(callers).toEqual(["fetch-url-retriever.ts"]);
  });

  it("keeps the domain free of framework, database, and environment access", () => {
    // `url-safety.ts` is the file this protects. It is a security control, and a
    // security control that imports `next/` or reads the environment cannot be tested
    // exhaustively — which is exactly what it needs to be.
    const forbidden = [
      "react",
      "next/",
      "better-sqlite3",
      "server-only",
      "zod",
    ];

    for (const file of sourcesFiles("domain")) {
      for (const specifier of importSpecifiers(file)) {
        expect(forbidden).not.toContain(specifier);
      }
    }
  });

  it("keeps the domain free of filesystem access", () => {
    // The domain names object keys — see `objectKeyForContentHash` — and never reads or
    // writes one. Storage is behind `ObjectStorage` so D13 can swap in S3.
    for (const file of sourcesFiles("domain")) {
      for (const specifier of importSpecifiers(file)) {
        expect(specifier).not.toMatch(/^node:fs/);
      }
    }
  });

  it("never reads the environment outside infrastructure", () => {
    const readers = [
      ...sourcesFiles("domain"),
      ...sourcesFiles("application"),
      ...sourcesFiles("ports"),
      ...sourcesFiles("ui"),
    ]
      .filter((file) => readFileSync(file, "utf8").includes("process.env"))
      .map((file) => file.split(sep).at(-1));

    expect(readers).toEqual([]);
  });

  it("keeps the application layer off the infrastructure layer", () => {
    // The facade depends on ports only. Tests are exempt: a facade test's job is to
    // drive the facade through real adapters, which is the layering working.
    expect(
      sourcesFiles("application")
        .filter((file) => !file.endsWith(".test.ts"))
        .filter((file) =>
          importSpecifiers(file).some((specifier) =>
            specifier.includes("sources/infrastructure"),
          ),
        )
        .map((file) => file.split(sep).at(-1)),
    ).toEqual([]);
  });

  it("logs nothing at all, so no source text can reach a log", () => {
    // An import carries a whole document, and a retrieval carries a response an
    // arbitrary server chose. `spec/SECURITY.md`: content is never logged, and logging
    // nothing is the cheapest way to guarantee it.
    for (const file of sourcesFiles()) {
      expect(readFileSync(file, "utf8")).not.toMatch(/\bconsole\.\w+\(/);
    }
  });
});
