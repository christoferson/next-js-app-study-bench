import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dependency-direction checks for the ai-generation module.
 *
 * The module tree is `question-bank ← flashcards ← ai-generation`
 * (`spec/ARCHITECTURE.md` section 7): generation reads and writes both banks, and
 * neither bank — nor study-sessions, which composes from them — may know that
 * generation exists. Without a check, that direction is a convention one convenient
 * import would quietly reverse, and the resulting cycle would only show up as a
 * confusing build failure much later.
 *
 * A source scan rather than a lint rule: this is a small number of stated facts about
 * this repository, and reading them here means the reason is next to the assertion.
 * The scan is deliberately literal — it looks for the module path in `from "..."`
 * specifiers — so it cannot be defeated by accident, only deliberately.
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
  it("keeps study-sessions unaware of ai-generation", () => {
    // A session composes from the banks. Where an item came from is provenance the
    // bank already records, so a session has no reason to reach into generation, and
    // an import here would make the two modules mutually dependent.
    expect(offenders("study-sessions", "modules/ai-generation")).toEqual([]);
  });

  it("keeps the question bank unaware of ai-generation", () => {
    expect(offenders("question-bank", "modules/ai-generation")).toEqual([]);
  });

  it("keeps flashcards unaware of ai-generation", () => {
    expect(offenders("flashcards", "modules/ai-generation")).toEqual([]);
  });

  it("keeps certifications unaware of ai-generation", () => {
    expect(offenders("certifications", "modules/ai-generation")).toEqual([]);
  });
});

describe("ai-generation internal boundaries", () => {
  /** Files under one path within the ai-generation module. */
  function generationFiles(...segments: readonly string[]): readonly string[] {
    return sourceFiles(join(MODULES, "ai-generation", ...segments));
  }

  it("keeps the AWS SDK inside the one adapter that owns it", () => {
    // `spec/AI-GUIDELINES.md` section 1.1: application and domain code never import
    // the Bedrock SDK. Only the adapter and its own test may.
    const importers = generationFiles()
      .filter((file) =>
        importSpecifiers(file).some((specifier) =>
          specifier.startsWith("@aws-sdk/"),
        ),
      )
      .map((file) => file.split(sep).at(-1));

    expect([...importers].sort()).toEqual([
      "bedrock-language-model-gateway.test.ts",
      "bedrock-language-model-gateway.ts",
    ]);
  });

  it("names the PDF library nowhere at all", () => {
    // Same rule as the AWS SDK, for the same reason: `unpdf` is an infrastructure
    // detail behind `@/platform/documents/document-text-extractor`, and the facade
    // takes bytes and a kind so it can be tested with a stub extractor. An
    // application-layer import would put a PDF parser — and a second text-extraction
    // path — inside the flow the unit tests exercise.
    //
    // The adapter itself moved to `platform/documents/` in D8, because the source
    // library reads the same PDFs and a sources-module import of
    // `ai-generation/infrastructure` would be the wrong direction
    // (`sources ← ai-generation`). So this module now names the library in no file at
    // all, not even one.
    const importers = generationFiles()
      .filter((file) =>
        importSpecifiers(file).some(
          (specifier) =>
            specifier === "unpdf" || specifier.startsWith("unpdf/"),
        ),
      )
      .map((file) => file.split(sep).at(-1));

    expect([...importers].sort()).toEqual([]);
  });

  it("keeps the domain free of framework, database, and environment access", () => {
    const forbidden = [
      "react",
      "next/",
      "better-sqlite3",
      "server-only",
      "zod",
    ];

    for (const file of generationFiles("domain")) {
      for (const specifier of importSpecifiers(file)) {
        expect(forbidden).not.toContain(specifier);
      }
    }
  });

  it("never reads the environment in the domain, application, or interface layers", () => {
    // `spec/ARCHITECTURE.md` section 4: configuration is resolved once, by
    // `infrastructure/config.ts`, and the composition root passes the result down. A
    // facade or a component reading `process.env` would make its behaviour depend on
    // where it happened to be constructed.
    const readers = [
      ...generationFiles("domain"),
      ...generationFiles("application"),
      ...generationFiles("ports"),
      ...generationFiles("ui"),
    ]
      .filter((file) => readFileSync(file, "utf8").includes("process.env"))
      .map((file) => file.split(sep).at(-1));

    expect(readers).toEqual([]);
  });

  it("logs nothing at all, so no prompt or credential can reach a log", () => {
    for (const file of generationFiles()) {
      expect(readFileSync(file, "utf8")).not.toMatch(/\bconsole\.\w+\(/);
    }
  });
});
