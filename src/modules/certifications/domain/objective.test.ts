import { describe, expect, it } from "vitest";
import { objectiveFixture } from "@/modules/certifications/infrastructure/test-support";
import {
  CyclicObjectiveParentError,
  InvalidParentObjectiveError,
  ObjectiveNotFoundError,
} from "./errors";
import {
  assertValidNewParent,
  assertValidReparent,
  buildObjectiveTree,
  collectDescendantIds,
  describeObjectiveOption,
  describeObjectiveSourceType,
  isOfficialSource,
  listObjectiveOptions,
  listReparentCandidates,
  SELECTABLE_OBJECTIVE_SOURCE_TYPES,
} from "./objective";

/** root → child → grandchild, plus a second root. */
const HIERARCHY = [
  objectiveFixture({ id: "root", title: "Root", displayOrder: 1 }),
  objectiveFixture({
    id: "child",
    parentObjectiveId: "root",
    title: "Child",
    displayOrder: 1,
  }),
  objectiveFixture({
    id: "grandchild",
    parentObjectiveId: "child",
    title: "Grandchild",
    displayOrder: 1,
  }),
  objectiveFixture({ id: "sibling", title: "Sibling root", displayOrder: 2 }),
];

describe("buildObjectiveTree", () => {
  it("nests objectives under their parents", () => {
    const tree = buildObjectiveTree(HIERARCHY);

    expect(tree.map((node) => node.objective.id)).toEqual(["root", "sibling"]);
    expect(tree[0]?.children.map((node) => node.objective.id)).toEqual([
      "child",
    ]);
    expect(
      tree[0]?.children[0]?.children.map((node) => node.objective.id),
    ).toEqual(["grandchild"]);
  });

  it("records the depth of each node", () => {
    const tree = buildObjectiveTree(HIERARCHY);

    expect(tree[0]?.depth).toBe(0);
    expect(tree[0]?.children[0]?.depth).toBe(1);
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
  });

  it("orders siblings by display order", () => {
    const tree = buildObjectiveTree([
      objectiveFixture({ id: "second", displayOrder: 2 }),
      objectiveFixture({ id: "first", displayOrder: 1 }),
      objectiveFixture({ id: "third", displayOrder: 3 }),
    ]);

    expect(tree.map((node) => node.objective.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("breaks a display-order tie deterministically by id", () => {
    const tree = buildObjectiveTree([
      objectiveFixture({ id: "bravo", displayOrder: 1 }),
      objectiveFixture({ id: "alpha", displayOrder: 1 }),
    ]);

    expect(tree.map((node) => node.objective.id)).toEqual(["alpha", "bravo"]);
  });

  it("surfaces an orphan at the root rather than hiding it", () => {
    const tree = buildObjectiveTree([
      objectiveFixture({ id: "orphan", parentObjectiveId: "absent-parent" }),
    ]);

    expect(tree.map((node) => node.objective.id)).toEqual(["orphan"]);
  });

  it("returns an empty forest for no objectives", () => {
    expect(buildObjectiveTree([])).toEqual([]);
  });
});

describe("listObjectiveOptions", () => {
  it("lists each root immediately followed by its own descendants", () => {
    // Hierarchy order, not repository order: a select that offered "Domain 1,
    // Domain 2, Task 1.1" would make a weighted domain and its tasks unfindable.
    expect(
      listObjectiveOptions(HIERARCHY).map((option) => option.objective.id),
    ).toEqual(["root", "child", "grandchild", "sibling"]);
  });

  it("carries the depth each objective was found at", () => {
    expect(
      listObjectiveOptions(HIERARCHY).map((option) => option.depth),
    ).toEqual([0, 1, 2, 0]);
  });

  it("uses the same sibling order as the tree view", () => {
    // The ordering is a flattening of `buildObjectiveTree`, so the option list and
    // the track page cannot disagree.
    const objectives = [
      objectiveFixture({ id: "second", displayOrder: 2 }),
      objectiveFixture({ id: "first", displayOrder: 1 }),
    ];

    expect(
      listObjectiveOptions(objectives).map((option) => option.objective.id),
    ).toEqual(buildObjectiveTree(objectives).map((node) => node.objective.id));
  });

  it("returns nothing for no objectives", () => {
    expect(listObjectiveOptions([])).toEqual([]);
  });
});

describe("describeObjectiveOption", () => {
  it("puts the code before the title", () => {
    expect(
      describeObjectiveOption({
        objective: objectiveFixture({ code: "Domain 1", title: "Foundations" }),
        depth: 0,
      }),
    ).toBe("Domain 1 — Foundations");
  });

  it("omits the separator when the objective has no code", () => {
    expect(
      describeObjectiveOption({
        objective: objectiveFixture({ code: null, title: "Foundations" }),
        depth: 0,
      }),
    ).toBe("Foundations");
  });

  it("indents a child by two non-breaking spaces per level", () => {
    expect(
      describeObjectiveOption({
        objective: objectiveFixture({ code: "Task 1.1", title: "Analyse" }),
        depth: 1,
      }),
    ).toBe("\u00a0\u00a0Task 1.1 — Analyse");
    expect(
      describeObjectiveOption({
        objective: objectiveFixture({ code: null, title: "Deeper" }),
        depth: 2,
      }),
    ).toBe("\u00a0\u00a0\u00a0\u00a0Deeper");
  });

  it("says when an objective is archived, so a stale filter is explicable", () => {
    expect(
      describeObjectiveOption({
        objective: objectiveFixture({
          code: null,
          title: "Retired area",
          status: "ARCHIVED",
        }),
        depth: 0,
      }),
    ).toBe("Retired area (archived)");
  });
});

describe("collectDescendantIds", () => {
  it("returns every descendant without the objective itself", () => {
    expect([...collectDescendantIds(HIERARCHY, "root")].sort()).toEqual([
      "child",
      "grandchild",
    ]);
  });

  it("returns an empty set for a leaf", () => {
    expect(collectDescendantIds(HIERARCHY, "grandchild").size).toBe(0);
  });

  it("terminates on a corrupted cyclic parent chain", () => {
    const cyclic = [
      objectiveFixture({ id: "a", parentObjectiveId: "b" }),
      objectiveFixture({ id: "b", parentObjectiveId: "a" }),
    ];

    expect([...collectDescendantIds(cyclic, "a")].sort()).toEqual(["a", "b"]);
  });
});

describe("assertValidNewParent", () => {
  it("accepts a top-level objective", () => {
    expect(() => assertValidNewParent(HIERARCHY, null)).not.toThrow();
  });

  it("accepts an existing parent within the certification", () => {
    expect(() => assertValidNewParent(HIERARCHY, "child")).not.toThrow();
  });

  it("rejects a parent that does not exist", () => {
    expect(() => assertValidNewParent(HIERARCHY, "no-such-parent")).toThrow(
      InvalidParentObjectiveError,
    );
  });

  it("rejects a parent belonging to a different certification", () => {
    // Objectives are always loaded per certification, so an objective from
    // another track is simply absent from the list.
    expect(() => assertValidNewParent([], "objective-in-other-track")).toThrow(
      InvalidParentObjectiveError,
    );
  });
});

describe("assertValidReparent", () => {
  it("accepts a move to the top level", () => {
    expect(() =>
      assertValidReparent(HIERARCHY, "grandchild", null),
    ).not.toThrow();
  });

  it("accepts a move under an unrelated objective", () => {
    expect(() =>
      assertValidReparent(HIERARCHY, "grandchild", "sibling"),
    ).not.toThrow();
  });

  it("rejects making an objective its own parent", () => {
    expect(() => assertValidReparent(HIERARCHY, "root", "root")).toThrow(
      CyclicObjectiveParentError,
    );
  });

  it("rejects a move under a direct child", () => {
    expect(() => assertValidReparent(HIERARCHY, "root", "child")).toThrow(
      CyclicObjectiveParentError,
    );
  });

  it("rejects a move under a deeper descendant", () => {
    expect(() => assertValidReparent(HIERARCHY, "root", "grandchild")).toThrow(
      CyclicObjectiveParentError,
    );
  });

  it("rejects a move of an objective that does not exist", () => {
    expect(() => assertValidReparent(HIERARCHY, "missing", null)).toThrow(
      ObjectiveNotFoundError,
    );
  });

  it("rejects a move under a parent that does not exist", () => {
    expect(() => assertValidReparent(HIERARCHY, "root", "absent")).toThrow(
      InvalidParentObjectiveError,
    );
  });

  it("reports the cycle against the parent field", () => {
    try {
      assertValidReparent(HIERARCHY, "root", "grandchild");
      expect.unreachable("expected a cyclic parent error");
    } catch (error) {
      expect(error).toBeInstanceOf(CyclicObjectiveParentError);
      expect(
        (error as CyclicObjectiveParentError).fieldMessages(),
      ).toHaveProperty("parentObjectiveId");
    }
  });
});

describe("listReparentCandidates", () => {
  it("excludes the objective itself and its descendants", () => {
    const candidates = listReparentCandidates(HIERARCHY, "root");

    expect(candidates.map((objective) => objective.id)).toEqual(["sibling"]);
  });

  it("offers every other objective for a leaf", () => {
    const candidates = listReparentCandidates(HIERARCHY, "grandchild");

    expect(candidates.map((objective) => objective.id).sort()).toEqual([
      "child",
      "root",
      "sibling",
    ]);
  });

  it("never offers a candidate that reparenting would reject", () => {
    for (const objective of HIERARCHY) {
      for (const candidate of listReparentCandidates(HIERARCHY, objective.id)) {
        expect(() =>
          assertValidReparent(HIERARCHY, objective.id, candidate.id),
        ).not.toThrow();
      }
    }
  });
});

describe("objective source types", () => {
  it("labels every source type", () => {
    expect(describeObjectiveSourceType("OFFICIAL")).toBe("Official");
    expect(describeObjectiveSourceType("OFFICIAL_SYLLABUS")).toBe(
      "Official syllabus",
    );
    expect(describeObjectiveSourceType("USER_DEFINED")).toBe("User defined");
    expect(describeObjectiveSourceType("AI_PROPOSED")).toBe("AI proposed");
    expect(describeObjectiveSourceType("IMPORTED")).toBe("Imported");
  });

  it("treats only official sources as official", () => {
    expect(isOfficialSource("OFFICIAL")).toBe(true);
    expect(isOfficialSource("OFFICIAL_SYLLABUS")).toBe(true);
    expect(isOfficialSource("USER_DEFINED")).toBe(false);
    expect(isOfficialSource("AI_PROPOSED")).toBe(false);
    expect(isOfficialSource("IMPORTED")).toBe(false);
  });

  it("does not offer AI-proposed or imported sources in a manual form", () => {
    expect(SELECTABLE_OBJECTIVE_SOURCE_TYPES).not.toContain("AI_PROPOSED");
    expect(SELECTABLE_OBJECTIVE_SOURCE_TYPES).not.toContain("IMPORTED");
  });
});
