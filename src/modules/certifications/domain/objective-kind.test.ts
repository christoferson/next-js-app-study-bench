import { describe, expect, it } from "vitest";
import { objectiveFixture } from "@/modules/certifications/infrastructure/test-support";
import type { Objective } from "./objective";
import {
  GRAMMAR_ROOT,
  TASKS_ROOT_TITLE,
  TOPICS_ROOT_TITLE,
  VOCABULARY_LIST_ROOT,
  objectiveKind,
} from "./objective-kind";

/**
 * Classifying an objective by the root it descends from.
 *
 * The kind decides what a generated drill looks like, so what is pinned here is that
 * the classification comes from the tree and from the owner's own recorded titles —
 * never from a track's name, provider, or slug — and that anything unrecognised falls
 * back to `GENERAL` so a technical certification's prompts are unchanged.
 */

function objective(overrides: Partial<Objective>): Objective {
  return objectiveFixture(overrides);
}

/** A grammar point three levels down, as the syllabus import writes it. */
function grammarTree(): readonly Objective[] {
  return [
    objective({
      id: "grammar-root",
      code: GRAMMAR_ROOT.code,
      title: GRAMMAR_ROOT.title,
      sourceType: "OFFICIAL_SYLLABUS",
    }),
    objective({
      id: "grammar-group",
      parentObjectiveId: "grammar-root",
      code: "复句",
      title: "复句",
      sourceType: "OFFICIAL_SYLLABUS",
    }),
    objective({
      id: "grammar-point",
      parentObjectiveId: "grammar-group",
      code: "复句",
      title: "与其……不如……",
      sourceType: "OFFICIAL_SYLLABUS",
    }),
  ];
}

describe("objectiveKind", () => {
  it("classifies a grammar point by the appendix it sits under", () => {
    // Not by the objective itself: a point's own title *is* the pattern, and there
    // is nothing in "与其……不如……" that says "grammar".
    const tree = grammarTree();

    expect(objectiveKind(tree, "grammar-point")).toBe("GRAMMAR");
    expect(objectiveKind(tree, "grammar-group")).toBe("GRAMMAR");
    expect(objectiveKind(tree, "grammar-root")).toBe("GRAMMAR");
  });

  it("recognises the grammar root by either its code or its title", () => {
    // The owner may rename an imported root, and a renamed grammar root is still
    // the grammar root — which is the rule the import's own idempotency check uses.
    const renamed = [
      objective({
        id: "root",
        code: GRAMMAR_ROOT.code,
        title: "Sentence patterns",
      }),
      objective({ id: "point", parentObjectiveId: "root", title: "……，便……" }),
    ];
    const recoded = [
      objective({ id: "root", code: null, title: GRAMMAR_ROOT.title }),
      objective({ id: "point", parentObjectiveId: "root", title: "……，便……" }),
    ];

    expect(objectiveKind(renamed, "point")).toBe("GRAMMAR");
    expect(objectiveKind(recoded, "point")).toBe("GRAMMAR");
  });

  it("classifies both unofficial theme roots as themes", () => {
    for (const title of [TOPICS_ROOT_TITLE, TASKS_ROOT_TITLE]) {
      const tree = [
        objective({ id: "root", code: null, title, sourceType: "AI_PROPOSED" }),
        objective({
          id: "theme",
          parentObjectiveId: "root",
          code: null,
          title: "环境保护 — environmental protection",
          sourceType: "AI_PROPOSED",
        }),
      ];

      expect(objectiveKind(tree, "theme")).toBe("THEME");
      expect(objectiveKind(tree, "root")).toBe("THEME");
    }
  });

  it("keeps the word unofficial in the theme root titles", () => {
    // The titles are a contract with the import, and the word is what stops
    // AI-proposed objectives from reading as published syllabus
    // (`SPEC.md` section 6.2).
    expect(TOPICS_ROOT_TITLE).toMatch(/unofficial/);
    expect(TASKS_ROOT_TITLE).toMatch(/unofficial/);
  });

  it("classifies the imported word list", () => {
    const tree = [
      objective({
        id: "root",
        code: VOCABULARY_LIST_ROOT.code,
        title: VOCABULARY_LIST_ROOT.title,
        sourceType: "IMPORTED",
      }),
    ];

    expect(objectiveKind(tree, "root")).toBe("VOCABULARY_LIST");
  });

  it("treats an ordinary exam domain as general", () => {
    // Every technical certification lands here, so its prompts are unchanged.
    const tree = [
      objective({ id: "domain", code: "1.0", title: "Cloud Concepts" }),
      objective({
        id: "sub",
        parentObjectiveId: "domain",
        code: "1.1",
        title: "Define the benefits of the cloud",
      }),
    ];

    expect(objectiveKind(tree, "domain")).toBe("GENERAL");
    expect(objectiveKind(tree, "sub")).toBe("GENERAL");
  });

  it("keeps the examination-structure roots general", () => {
    // "Reading, part 2" describes a question format, not a subject to drill, and the
    // formats are not what the drill prompts branch on.
    const tree = [
      objective({ id: "reading", code: "阅读", title: "Reading" }),
      objective({
        id: "part",
        parentObjectiveId: "reading",
        code: "第一部分",
        title: "Part 1 (15 items)",
      }),
    ];

    expect(objectiveKind(tree, "part")).toBe("GENERAL");
  });

  it("classifies by the root even when the parent is archived", () => {
    // An archived parent still says where its children sit.
    const tree = [
      ...grammarTree().map((entry) =>
        entry.id === "grammar-group"
          ? { ...entry, status: "ARCHIVED" as const }
          : entry,
      ),
    ];

    expect(objectiveKind(tree, "grammar-point")).toBe("GRAMMAR");
  });

  it("stops at the highest objective it can reach when a parent is missing", () => {
    // The same choice `buildObjectiveTree` makes: an objective whose parent was
    // filtered out is surfaced at the root rather than disappearing.
    const orphan = [
      objective({
        id: "grammar-group",
        parentObjectiveId: "absent-root",
        code: GRAMMAR_ROOT.code,
        title: "复句",
      }),
    ];

    expect(objectiveKind(orphan, "grammar-group")).toBe("GRAMMAR");
  });

  it("returns general for an objective that is not in the set", () => {
    expect(objectiveKind(grammarTree(), "no-such-objective")).toBe("GENERAL");
    expect(objectiveKind([], "grammar-point")).toBe("GENERAL");
  });

  it("does not hang on a cycle the repository should have prevented", () => {
    const cyclic = [
      objective({ id: "a", parentObjectiveId: "b", title: "First" }),
      objective({ id: "b", parentObjectiveId: "a", title: "Second" }),
    ];

    expect(objectiveKind(cyclic, "a")).toBe("GENERAL");
  });
});
