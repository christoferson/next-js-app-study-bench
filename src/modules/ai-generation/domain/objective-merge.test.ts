import { describe, expect, it } from "vitest";
import { MAX_IMPORT_DEPTH } from "./objective-import";
import type { ProposedObjective } from "./objective-import";
import {
  MAX_MERGE_ITEMS,
  checkObjectiveMerge,
  countMergeItems,
  defaultCheckedMergeKeys,
  flattenForMerge,
  mergeItemKey,
  selectableMergeAdds,
  selectedMergeEnriches,
} from "./objective-merge";
import type {
  ExistingObjectiveNode,
  MergeAdd,
  MergeEnrich,
  MergeItem,
  MergeSkip,
  MergeSourceNode,
  ObjectiveMergePlan,
} from "./objective-merge";

/**
 * The deterministic half of the merge.
 *
 * `checkObjectiveMerge` is what makes trusting a model with the owner's objective
 * hierarchy defensible: a plan that references a node nobody sent, an objective that does
 * not exist, or a parent that comes after its child cannot be applied without guessing, and
 * guessing here means writing something the owner did not agree to. So the tests are
 * organised by what a bad plan could do, not by field.
 *
 * Every message is also checked for one property in particular: it names a path and an
 * expectation and never a character of the owner's document, because these messages drive
 * the gateway's one repair attempt and travel back to the provider
 * (`spec/AI-GUIDELINES.md` section 1.7).
 */
function node(overrides: Partial<ProposedObjective> = {}): ProposedObjective {
  return {
    code: null,
    title: "Demo objective",
    description: null,
    weight: null,
    children: [],
    ...overrides,
  };
}

function existing(
  overrides: Partial<ExistingObjectiveNode> = {},
): ExistingObjectiveNode {
  return {
    id: "objective-1",
    code: "1",
    title: "Demo Foundations",
    depth: 1,
    parentId: null,
    ...overrides,
  };
}

function source(overrides: Partial<MergeSourceNode> = {}): MergeSourceNode {
  return {
    ref: "n1",
    title: "Describe demo quotas",
    code: null,
    description: null,
    weight: null,
    depth: 1,
    parentRef: null,
    ...overrides,
  };
}

function addItem(overrides: Partial<MergeAdd> = {}): MergeAdd {
  return {
    kind: "ADD",
    ref: "n1",
    parentExistingId: null,
    parentRef: null,
    code: null,
    title: "Describe demo quotas",
    description: null,
    weight: null,
    ...overrides,
  };
}

function enrichItem(overrides: Partial<MergeEnrich> = {}): MergeEnrich {
  return {
    kind: "ENRICH",
    ref: "n1",
    existingId: "objective-1",
    description: "What the new document adds.",
    ...overrides,
  };
}

function skipItem(overrides: Partial<MergeSkip> = {}): MergeSkip {
  return {
    kind: "SKIP",
    ref: "n1",
    reason: "Already covered.",
    matchedExistingId: null,
    ...overrides,
  };
}

function plan(items: readonly MergeItem[]): ObjectiveMergePlan {
  return { items, summary: "A demo reconciliation." };
}

function check(
  items: readonly MergeItem[],
  options: {
    readonly sourceNodes?: readonly MergeSourceNode[];
    readonly existing?: readonly ExistingObjectiveNode[];
    readonly summary?: string;
  } = {},
): readonly string[] {
  return checkObjectiveMerge(
    {
      items,
      summary: options.summary ?? "A demo reconciliation.",
    },
    options.sourceNodes ?? [source()],
    options.existing ?? [existing()],
  );
}

describe("flattenForMerge", () => {
  it("numbers the tree depth-first, which is document order", () => {
    // The refs are the addressing scheme for the whole merge — prompt, checks, stored
    // payload, and confirm page — so the numbering has to be the one thing everything
    // agrees on. Depth-first is document order, which is the order the owner read.
    const nodes = flattenForMerge([
      node({
        title: "One",
        children: [node({ title: "One A" }), node({ title: "One B" })],
      }),
      node({ title: "Two" }),
    ]);

    expect(nodes.map((one) => [one.ref, one.title, one.parentRef])).toEqual([
      ["n1", "One", null],
      ["n2", "One A", "n1"],
      ["n3", "One B", "n1"],
      ["n4", "Two", null],
    ]);
  });

  it("records the depth each node sits at, roots first", () => {
    const nodes = flattenForMerge([
      node({ children: [node({ children: [node()] })] }),
    ]);

    expect(nodes.map((one) => one.depth)).toEqual([1, 2, 3]);
  });

  it("carries the code, description, and weight through unchanged", () => {
    // The merge prompt describes each extracted node from this, so anything dropped here
    // is something the model cannot take into account.
    const nodes = flattenForMerge([
      node({ code: "1.2", description: "What it says.", weight: 40 }),
    ]);

    expect(nodes[0]).toMatchObject({
      code: "1.2",
      description: "What it says.",
      weight: 40,
    });
  });

  it("is empty for an empty proposal", () => {
    expect(flattenForMerge([])).toEqual([]);
  });
});

describe("mergeItemKey", () => {
  it("keys an addition and an enrichment separately, by ref", () => {
    // Two verdicts about the same extracted node would collide on the ref alone, and a
    // key derived from position would apply the wrong item after a re-read.
    expect(mergeItemKey(addItem({ ref: "n7" }))).toBe("add:n7");
    expect(mergeItemKey(enrichItem({ ref: "n7" }))).toBe("enrich:n7");
  });

  it("gives a skip no key, because there is nothing to apply", () => {
    expect(mergeItemKey(skipItem())).toBeNull();
  });
});

describe("countMergeItems", () => {
  it("counts each verdict kind", () => {
    expect(
      countMergeItems([addItem(), addItem(), enrichItem(), skipItem()]),
    ).toEqual({ adds: 2, enriches: 1, skips: 1 });
  });
});

describe("checkObjectiveMerge", () => {
  it("accepts a plan that adds, enriches, and skips within the rules", () => {
    expect(
      check(
        [
          addItem({ ref: "n1", parentExistingId: "objective-1" }),
          enrichItem({ ref: "n2" }),
          skipItem({ ref: "n3", matchedExistingId: "objective-1" }),
        ],
        {
          sourceNodes: [
            source({ ref: "n1" }),
            source({ ref: "n2" }),
            source({ ref: "n3" }),
          ],
        },
      ),
    ).toEqual([]);
  });

  describe("the nodes a plan may talk about", () => {
    it("rejects a verdict about a ref that was never sent", () => {
      // The reason refs are assigned by the sender: a model cannot invent an objective to
      // have an opinion about.
      const problems = check([addItem({ ref: "n99" })]);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("merge.items[0].ref");
      expect(problems[0]).toContain(
        "names no extracted objective that was sent",
      );
    });

    it("rejects a second verdict about the same ref", () => {
      const problems = check([addItem(), skipItem()]);

      expect(problems).toEqual([
        expect.stringContaining(
          "a second verdict for the same extracted objective",
        ),
      ]);
    });

    it("rejects more verdicts than one merge accepts", () => {
      const sourceNodes = Array.from({ length: MAX_MERGE_ITEMS + 1 }, (_u, i) =>
        source({ ref: `n${i + 1}` }),
      );
      const problems = check(
        sourceNodes.map((one) => addItem({ ref: one.ref })),
        { sourceNodes },
      );

      expect(problems[0]).toContain(String(MAX_MERGE_ITEMS));
    });

    it("rejects an empty summary, which is the confirm page's lede", () => {
      expect(check([addItem()], { summary: "   " })).toEqual([
        "merge.summary: must not be empty",
      ]);
    });
  });

  describe("where an addition may go", () => {
    it("rejects a parent that is not in the existing objectives", () => {
      const problems = check([addItem({ parentExistingId: "objective-404" })]);

      expect(problems).toEqual([
        expect.stringContaining("merge.items[0].parentExistingId"),
      ]);
    });

    it("rejects naming both an existing parent and one among the additions", () => {
      // Two answers to "where does this go" is no answer, and picking one for the model
      // would be exactly the guess this check exists to refuse.
      const problems = check(
        [
          addItem({ ref: "n1" }),
          addItem({
            ref: "n2",
            parentExistingId: "objective-1",
            parentRef: "n1",
          }),
        ],
        { sourceNodes: [source({ ref: "n1" }), source({ ref: "n2" })] },
      );

      expect(problems).toEqual([
        expect.stringContaining("names both an existing parent"),
      ]);
    });

    it("accepts an addition nested under an earlier addition", () => {
      expect(
        check(
          [addItem({ ref: "n1" }), addItem({ ref: "n2", parentRef: "n1" })],
          {
            sourceNodes: [source({ ref: "n1" }), source({ ref: "n2" })],
          },
        ),
      ).toEqual([]);
    });

    it("rejects a parent among the additions that comes later", () => {
      // A forward reference is what would force a second pass at apply time, so it is
      // refused here and the apply can resolve every parent in one.
      const problems = check(
        [addItem({ ref: "n1", parentRef: "n2" }), addItem({ ref: "n2" })],
        { sourceNodes: [source({ ref: "n1" }), source({ ref: "n2" })] },
      );

      expect(problems).toEqual([
        expect.stringContaining("names no earlier addition"),
      ]);
    });

    it("rejects an addition that would nest past the depth cap", () => {
      const existingLeaf = existing({
        id: "objective-deep",
        depth: MAX_IMPORT_DEPTH,
      });
      const problems = check([addItem({ parentExistingId: existingLeaf.id })], {
        existing: [existingLeaf],
      });

      expect(problems[0]).toContain(String(MAX_IMPORT_DEPTH + 1));
      expect(problems[0]).toContain("levels deep");
    });

    it("counts depth through a chain of additions, not just the first", () => {
      // Three additions under an existing root is a fourth level even though no single
      // verdict says so.
      const sourceNodes = [
        source({ ref: "n1" }),
        source({ ref: "n2" }),
        source({ ref: "n3" }),
      ];
      const problems = check(
        [
          addItem({ ref: "n1", parentExistingId: "objective-1" }),
          addItem({ ref: "n2", parentRef: "n1" }),
          addItem({ ref: "n3", parentRef: "n2" }),
        ],
        { sourceNodes },
      );

      expect(problems).toEqual([expect.stringContaining("merge.items[2]")]);
    });

    it("rejects an addition with no title, which is what an objective is", () => {
      expect(check([addItem({ title: "  " })])).toEqual([
        "merge.items[0].title: must not be empty",
      ]);
    });
  });

  describe("what an enrichment may touch", () => {
    it("rejects an objective that does not exist", () => {
      const problems = check([enrichItem({ existingId: "objective-404" })]);

      expect(problems).toEqual([
        expect.stringContaining("merge.items[0].existingId"),
      ]);
    });

    it("rejects two enrichments of the same objective", () => {
      // Applying both would make the last one win silently, so the model is asked to
      // combine them into the one description it wants stored.
      const problems = check(
        [enrichItem({ ref: "n1" }), enrichItem({ ref: "n2" })],
        { sourceNodes: [source({ ref: "n1" }), source({ ref: "n2" })] },
      );

      expect(problems).toEqual([
        expect.stringContaining(
          "a second enrichment of the same existing objective",
        ),
      ]);
    });

    it("rejects an empty description, which would be a deletion", () => {
      const problems = check([enrichItem({ description: " " })]);

      expect(problems).toEqual([
        expect.stringContaining("rather than clearing it"),
      ]);
    });
  });

  describe("what a skip must say", () => {
    it("rejects a skip with no reason", () => {
      // The reason is the only thing that makes a skip auditable: without it the owner
      // cannot tell a duplicate from a dropped objective.
      const problems = check([skipItem({ reason: "" })]);

      expect(problems).toEqual([
        expect.stringContaining("say why this objective is already covered"),
      ]);
    });

    it("rejects a matched objective that does not exist", () => {
      const problems = check([
        skipItem({ matchedExistingId: "objective-404" }),
      ]);

      expect(problems).toEqual([
        expect.stringContaining("merge.items[0].matchedExistingId"),
      ]);
    });

    it("accepts a skip that matches nothing in particular", () => {
      expect(check([skipItem({ matchedExistingId: null })])).toEqual([]);
    });
  });

  it("reports every problem rather than the first", () => {
    // The messages drive one repair attempt, so all of them have to arrive at once.
    const problems = check(
      [
        addItem({ ref: "n1", title: "" }),
        enrichItem({ ref: "n2", existingId: "objective-404" }),
      ],
      {
        sourceNodes: [source({ ref: "n1" }), source({ ref: "n2" })],
        summary: "",
      },
    );

    expect(problems).toHaveLength(3);
  });

  it("never repeats the owner's text back in a message", () => {
    // These messages travel to the provider, so they carry a path and an expectation and
    // nothing out of the document.
    const secret = "A phrase only in the owner's own syllabus";
    const problems = check(
      [addItem({ title: secret }), skipItem({ ref: "n2" })],
      {
        sourceNodes: [source({ ref: "n1", title: secret })],
      },
    );

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).not.toContain(secret);
  });
});

describe("selectableMergeAdds", () => {
  const ITEMS: readonly MergeItem[] = [
    addItem({ ref: "n1", title: "Demo Quotas" }),
    addItem({ ref: "n2", title: "Soft quotas", parentRef: "n1" }),
    addItem({ ref: "n3", title: "Hard quotas", parentRef: "n2" }),
    addItem({ ref: "n4", title: "Demo Limits" }),
  ];

  it("returns the checked additions in plan order", () => {
    const selected = selectableMergeAdds(
      ITEMS,
      new Set(["add:n1", "add:n2", "add:n4"]),
    );

    expect(selected.adds.map((one) => one.ref)).toEqual(["n1", "n2", "n4"]);
    expect(selected.omitted).toEqual([]);
  });

  it("omits a checked addition whose parent addition was unchecked", () => {
    // Reparenting it onto the existing objective above would put a point directly under a
    // section the owner had just declined; refusing the whole apply would let one box
    // block everything. Dropping it and saying so is the third answer.
    const selected = selectableMergeAdds(ITEMS, new Set(["add:n2", "add:n4"]));

    expect(selected.adds.map((one) => one.ref)).toEqual(["n4"]);
    expect(selected.omitted.map((one) => one.ref)).toEqual(["n2"]);
  });

  it("cascades the omission down a chain", () => {
    const selected = selectableMergeAdds(
      ITEMS,
      new Set(["add:n2", "add:n3", "add:n4"]),
    );

    expect(selected.adds.map((one) => one.ref)).toEqual(["n4"]);
    expect(selected.omitted.map((one) => one.ref)).toEqual(["n2", "n3"]);
  });

  it("keeps an addition under an existing objective regardless of the others", () => {
    // Its parent is a row in the database, not a verdict, so no unticking can orphan it.
    const selected = selectableMergeAdds(
      [addItem({ ref: "n1", parentExistingId: "objective-1" })],
      new Set(["add:n1"]),
    );

    expect(selected.adds).toHaveLength(1);
  });

  it("ignores enrichments and skips", () => {
    const selected = selectableMergeAdds(
      [enrichItem({ ref: "n1" }), skipItem({ ref: "n2" })],
      new Set(["enrich:n1"]),
    );

    expect(selected.adds).toEqual([]);
  });
});

describe("selectedMergeEnriches", () => {
  it("returns only the checked enrichments", () => {
    expect(
      selectedMergeEnriches(
        [
          enrichItem({ ref: "n1" }),
          enrichItem({ ref: "n2", existingId: "objective-2" }),
        ],
        new Set(["enrich:n2"]),
      ).map((one) => one.ref),
    ).toEqual(["n2"]);
  });

  it("returns nothing when nothing is checked", () => {
    expect(selectedMergeEnriches([enrichItem()], new Set())).toEqual([]);
  });
});

describe("defaultCheckedMergeKeys", () => {
  it("checks every addition and enrichment and no skip", () => {
    // The owner uploaded the document in order to get these; a skip is not something they
    // can ask for.
    expect(
      defaultCheckedMergeKeys([
        addItem({ ref: "n1" }),
        enrichItem({ ref: "n2" }),
        skipItem({ ref: "n3" }),
      ]),
    ).toEqual(["add:n1", "enrich:n2"]);
  });
});

describe("plan", () => {
  it("is a plain value, so a plan can be built without a model", () => {
    // Guards the domain boundary: nothing here needs zod, a database, or a framework.
    expect(plan([addItem()]).items).toHaveLength(1);
  });
});
