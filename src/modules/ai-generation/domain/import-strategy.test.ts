import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_MODEL_PROVIDER,
  IMPORT_STRATEGY_KEYS,
  MAX_DETERMINISTIC_IMPORT_NODES,
  defaultImportStrategy,
  findImportStrategy,
  importNodeCapForRun,
  importStrategiesFor,
  importStrategy,
} from "./import-strategy";
import { MAX_IMPORT_NODES } from "./objective-import";

/**
 * The import-strategy registry.
 *
 * Two things are worth holding here. One: every strategy is *offered* for every track, so
 * an ordering rule can never become a hiding rule — a language track with a prose syllabus
 * must still be able to reach the AI reader. Two: the node cap a run is re-validated
 * against has to be recoverable from the run row, because the confirm page and the apply
 * step read the payload back long after the extraction chose the cap.
 */
describe("the import strategy registry", () => {
  it("has an entry for every key", () => {
    for (const key of IMPORT_STRATEGY_KEYS) {
      expect(importStrategy(key).key).toBe(key);
    }
  });

  it("describes each strategy well enough for the form to render it", () => {
    for (const key of IMPORT_STRATEGY_KEYS) {
      const strategy = importStrategy(key);

      expect(strategy.label.length).toBeGreaterThan(0);
      expect(strategy.description.length).toBeGreaterThan(0);
      expect(strategy.acceptedInputs.length).toBeGreaterThan(0);
    }
  });

  it("names no strategy for an unknown key", () => {
    expect(findImportStrategy("HSK_EXAMINATIONS")).toBeNull();
    expect(findImportStrategy("")).toBeNull();
  });

  describe("which one a track is offered first", () => {
    it("offers the HSK reader first for a language track", () => {
      expect(importStrategiesFor("LANGUAGE").map((one) => one.key)).toEqual([
        "HSK_EXAMINATION",
        "GENERIC_OUTLINE",
      ]);
      expect(defaultImportStrategy("LANGUAGE").key).toBe("HSK_EXAMINATION");
    });

    it("offers the AI reader first for a technical track", () => {
      expect(importStrategiesFor("TECHNICAL").map((one) => one.key)).toEqual([
        "GENERIC_OUTLINE",
        "HSK_EXAMINATION",
      ]);
      expect(defaultImportStrategy("TECHNICAL").key).toBe("GENERIC_OUTLINE");
    });

    it("offers every strategy to both, ordering rather than filtering", () => {
      // The point of the rule: a technical track that happens to hold an HSK document,
      // and a language track that holds a prose syllabus, both have a way through.
      for (const archetype of ["LANGUAGE", "TECHNICAL"] as const) {
        expect(
          importStrategiesFor(archetype)
            .map((one) => one.key)
            .sort(),
        ).toEqual([...IMPORT_STRATEGY_KEYS].sort());
      }
    });
  });

  describe("how many objectives each may propose", () => {
    it("holds a model to the extraction cap", () => {
      // An over-long tree is the shape a hallucinating extraction takes, so the model's
      // cap stays where it was.
      expect(importStrategy("GENERIC_OUTLINE").maxNodes).toBe(MAX_IMPORT_NODES);
    });

    it("allows a deterministic parse the size of its document", () => {
      // The HSK 5 plan is 117 objectives with themes included, which the model's cap of
      // 150 happens to clear and a longer level's grammar appendix would not. The input
      // is a published document read by a parser, not a model's answer, so the number is
      // a statement about the document rather than a guard against invention.
      expect(importStrategy("HSK_EXAMINATION").maxNodes).toBe(
        MAX_DETERMINISTIC_IMPORT_NODES,
      );
      expect(MAX_DETERMINISTIC_IMPORT_NODES).toBeGreaterThan(MAX_IMPORT_NODES);
    });
  });

  describe("the cap a recorded run is re-read with", () => {
    it("reads the deterministic cap back from the run's own provenance", () => {
      // No column of its own: a deterministic run records its strategy key as its model
      // id, which is what keeps this change out of the schema.
      expect(
        importNodeCapForRun({
          modelProvider: DETERMINISTIC_MODEL_PROVIDER,
          modelId: "HSK_EXAMINATION",
        }),
      ).toBe(MAX_DETERMINISTIC_IMPORT_NODES);
    });

    it("holds a real provider's run to the model cap", () => {
      expect(
        importNodeCapForRun({
          modelProvider: "bedrock",
          modelId: "some.model-v1",
        }),
      ).toBe(MAX_IMPORT_NODES);
    });

    it("falls back to the model cap for a strategy key it does not know", () => {
      // A run recorded by a future strategy that has since been removed reads back at the
      // stricter cap rather than at no cap at all.
      expect(
        importNodeCapForRun({
          modelProvider: DETERMINISTIC_MODEL_PROVIDER,
          modelId: "SOMETHING_ELSE",
        }),
      ).toBe(MAX_IMPORT_NODES);
    });
  });
});
