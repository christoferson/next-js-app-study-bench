import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dependency-direction checks for the audio module.
 *
 * Audio sits downstream of both banks: it reads a flashcard's content and a question's
 * stem to decide what can be spoken, and neither bank — nor certifications, which they
 * both hang off — may know that audio exists. The direction is
 * `question-bank ← flashcards ← audio ← study-sessions`
 * (`spec/ARCHITECTURE.md` section 7). Without a check that is a convention one
 * convenient import would quietly reverse.
 *
 * The scan mirrors `ai-generation/module-boundaries.test.ts` deliberately: same
 * technique, same literal matching on `from "..."` specifiers, so the two modules'
 * boundaries are stated the same way and a reader who has seen one has seen both.
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
  it("keeps the question bank unaware of audio", () => {
    // A question knows its stem and its language. That its stem can be read aloud is
    // audio's business, and an import here would make the two mutually dependent.
    expect(offenders("question-bank", "modules/audio")).toEqual([]);
  });

  it("keeps flashcards unaware of audio", () => {
    // The card that this feature exists for. Even so, `FlashcardContent` must stay a
    // description of what the owner wrote, not of what can be pronounced.
    expect(offenders("flashcards", "modules/audio")).toEqual([]);
  });

  it("keeps certifications unaware of audio", () => {
    // Audio reads `studyType` to pick a voice. The reverse — a track knowing which
    // voice it implies — would put a provider's vocabulary into the study model.
    expect(offenders("certifications", "modules/audio")).toEqual([]);
  });

  it("keeps ai-generation unaware of audio", () => {
    // Generation writes cards; speaking them is a separate, later, paid step. Nothing
    // generated should be synthesized as a side effect of being generated.
    expect(offenders("ai-generation", "modules/audio")).toEqual([]);
  });
});

describe("audio internal boundaries", () => {
  /** Files under one path within the audio module. */
  function audioFiles(...segments: readonly string[]): readonly string[] {
    return sourceFiles(join(MODULES, "audio", ...segments));
  }

  it("keeps the AWS SDK inside the one adapter that owns it", () => {
    // The port exists so that everything above it is testable with no AWS account and
    // no charge (`spec/TESTING.md` section 5). Only the Polly adapter and its own test
    // may name the SDK; the facade, the domain, the actions, and the fake gateway
    // must not.
    const importers = audioFiles()
      .filter((file) =>
        importSpecifiers(file).some((specifier) =>
          specifier.startsWith("@aws-sdk/"),
        ),
      )
      .map((file) => file.split(sep).at(-1));

    expect([...importers].sort()).toEqual([
      "polly-speech-synthesis-gateway.test.ts",
      "polly-speech-synthesis-gateway.ts",
    ]);
  });

  it("keeps the domain free of framework, database, and environment access", () => {
    const forbidden = [
      "react",
      "next/",
      "better-sqlite3",
      "server-only",
      "zod",
    ];

    for (const file of audioFiles("domain")) {
      for (const specifier of importSpecifiers(file)) {
        expect(forbidden).not.toContain(specifier);
      }
    }
  });

  it("keeps the domain free of filesystem access", () => {
    // The domain names object keys; it never reads or writes one. Storage is an
    // adapter behind `ObjectStorage` precisely so that D13 can swap in S3
    // (`spec/ARCHITECTURE.md` section 7.7).
    for (const file of audioFiles("domain")) {
      for (const specifier of importSpecifiers(file)) {
        expect(specifier).not.toMatch(/^node:fs/);
      }
    }
  });

  it("never reads the environment in the domain, application, or interface layers", () => {
    // `spec/ARCHITECTURE.md` section 4: the voice ids, the engine, and the provider are
    // resolved once by `infrastructure/config.ts` and passed down. A facade reading
    // `process.env` would make the voice depend on where it was constructed.
    const readers = [
      ...audioFiles("domain"),
      ...audioFiles("application"),
      ...audioFiles("ports"),
      ...audioFiles("ui"),
    ]
      .filter((file) => readFileSync(file, "utf8").includes("process.env"))
      .map((file) => file.split(sep).at(-1));

    expect(readers).toEqual([]);
  });

  it("keeps the application layer off the infrastructure layer", () => {
    // The facade depends on ports only. This is why the voice settings live in the
    // domain rather than on the config object the adapter parses.
    //
    // Tests are exempt, and deliberately: a facade test's whole job is to drive the
    // facade through a real adapter — the fake gateway, an in-memory repository — and
    // that is the layering working, not being violated. Only what ships is checked.
    expect(
      audioFiles("application")
        .filter((file) => !file.endsWith(".test.ts"))
        .filter((file) =>
          importSpecifiers(file).some((specifier) =>
            specifier.includes("audio/infrastructure"),
          ),
        )
        .map((file) => file.split(sep).at(-1)),
    ).toEqual([]);
  });

  it("logs nothing at all, so no owner content can reach a log", () => {
    // A synthesis request carries the text of a card. `spec/SECURITY.md`: content is
    // never logged, and the cheapest way to guarantee that is to log nothing.
    for (const file of audioFiles()) {
      expect(readFileSync(file, "utf8")).not.toMatch(/\bconsole\.\w+\(/);
    }
  });
});
