import { describe, expect, it } from "vitest";
import {
  MAX_MERGE_ITEMS,
  MERGE_DESCRIPTION_LIMIT,
  MERGE_TITLE_LIMIT,
} from "@/modules/ai-generation/domain/objective-merge";
import type {
  ExistingObjectiveNode,
  MergeSourceNode,
} from "@/modules/ai-generation/domain/objective-merge";
import type { JsonSchema } from "@/modules/ai-generation/ports/language-model-gateway";
import {
  objectiveMergeJsonSchema,
  objectiveMergeValidator,
  readStoredMergePlan,
  validateObjectiveMergePlan,
} from "./objective-merge-schema";

/**
 * The boundary between a provider's JSON and a merge plan the apply step can act on.
 *
 * Two things are being pinned down here, and they are different. The *tolerances* — a quoted
 * weight, a null field on the wrong kind, a description padded with whitespace — exist so a
 * merge is not thrown away over a formatting habit, and every one of them is a decision that
 * has to keep holding. The *refusals* are the other half: a missing required field for the
 * kind claimed, or a plan that does not apply to the tree that was sent.
 *
 * The messages are checked for one property throughout: they name a path and an expectation
 * and never the owner's text, because they drive the gateway's repair attempt and travel back
 * to the provider (`spec/AI-GUIDELINES.md` section 1.7).
 */
const SOURCE: readonly MergeSourceNode[] = [
  {
    ref: "n1",
    title: "Describe demo quotas",
    code: "1.1",
    description: null,
    weight: null,
    depth: 1,
    parentRef: null,
  },
  {
    ref: "n2",
    title: "Describe demo limits",
    code: "1.2",
    description: null,
    weight: null,
    depth: 1,
    parentRef: null,
  },
];

const EXISTING: readonly ExistingObjectiveNode[] = [
  {
    id: "objective-1",
    code: "1",
    title: "Demo Foundations",
    depth: 1,
    parentId: null,
  },
];

function validate(payload: unknown) {
  return validateObjectiveMergePlan(payload, SOURCE, EXISTING);
}

function errorsOf(payload: unknown): readonly string[] {
  const result = validate(payload);

  if (result.ok) {
    throw new Error("expected the payload to be rejected");
  }

  return result.errors;
}

function valueOf(payload: unknown) {
  const result = validate(payload);

  if (!result.ok) {
    throw new Error(
      `expected the payload to parse: ${result.errors.join("; ")}`,
    );
  }

  return result.value;
}

describe("validateObjectiveMergePlan", () => {
  it("parses a plan with one verdict of each kind", () => {
    const plan = valueOf({
      items: [
        {
          kind: "ADD",
          ref: "n1",
          title: "Describe demo quotas",
          code: "1.1",
          parentExistingId: "objective-1",
          weight: 20,
        },
        {
          kind: "SKIP",
          ref: "n2",
          reason: "Already covered by Demo Foundations.",
          matchedExistingId: "objective-1",
        },
      ],
      summary: "One new point, one already covered.",
    });

    expect(plan.items).toEqual([
      {
        kind: "ADD",
        ref: "n1",
        title: "Describe demo quotas",
        code: "1.1",
        description: null,
        parentExistingId: "objective-1",
        parentRef: null,
        weight: 20,
      },
      {
        kind: "SKIP",
        ref: "n2",
        reason: "Already covered by Demo Foundations.",
        matchedExistingId: "objective-1",
      },
    ]);
    expect(plan.summary).toBe("One new point, one already covered.");
  });

  describe("what it tolerates, so a merge is not lost to a formatting habit", () => {
    it("accepts a weight sent as a quoted percentage", () => {
      const plan = valueOf({
        items: [{ kind: "ADD", ref: "n1", title: "Quotas", weight: "20%" }],
        summary: "One addition.",
      });

      expect(plan.items[0]).toMatchObject({ weight: 20 });
    });

    it("treats an unparseable weight as none rather than failing the call", () => {
      // The weight is decoration on the objective; the objective itself is the point.
      const plan = valueOf({
        items: [
          { kind: "ADD", ref: "n1", title: "Quotas", weight: "about a fifth" },
        ],
        summary: "One addition.",
      });

      expect(plan.items[0]).toMatchObject({ weight: null });
    });

    it("discards the fields that belong to another kind", () => {
      // A model that fills every field on every item is not making a mistake worth a repair
      // round-trip, so the transform narrows to the kind claimed.
      const plan = valueOf({
        items: [
          {
            kind: "ADD",
            ref: "n1",
            title: "Quotas",
            existingId: "objective-1",
            reason: "not applicable",
            matchedExistingId: "objective-1",
          },
        ],
        summary: "One addition.",
      });

      expect(plan.items[0]).toEqual({
        kind: "ADD",
        ref: "n1",
        title: "Quotas",
        code: null,
        description: null,
        parentExistingId: null,
        parentRef: null,
        weight: null,
      });
    });

    it("reads a blank optional field as absent", () => {
      const plan = valueOf({
        items: [
          {
            kind: "ADD",
            ref: "n1",
            title: "Quotas",
            code: "   ",
            description: "",
          },
        ],
        summary: "One addition.",
      });

      expect(plan.items[0]).toMatchObject({ code: null, description: null });
    });

    it("trims the text it keeps", () => {
      const plan = valueOf({
        items: [{ kind: "ADD", ref: " n1 ", title: "  Quotas  " }],
        summary: "  One addition.  ",
      });

      expect(plan.items[0]).toMatchObject({ ref: "n1", title: "Quotas" });
      expect(plan.summary).toBe("One addition.");
    });

    it("accepts an omitted optional field as well as an explicit null", () => {
      const plan = valueOf({
        items: [
          { kind: "ADD", ref: "n1", title: "Quotas", parentExistingId: null },
          { kind: "SKIP", ref: "n2", reason: "Covered." },
        ],
        summary: "One of each.",
      });

      expect(plan.items).toHaveLength(2);
    });
  });

  describe("what each kind must actually say", () => {
    it("refuses an ADD with no title", () => {
      expect(
        errorsOf({
          items: [{ kind: "ADD", ref: "n1" }],
          summary: "One addition.",
        }),
      ).toEqual([
        "items.0.title: an ADD must state the title of the objective to add",
      ]);
    });

    it("refuses an ENRICH that names no existing objective", () => {
      const errors = errorsOf({
        items: [{ kind: "ENRICH", ref: "n1", description: "Extended." }],
        summary: "One enrichment.",
      });

      expect(errors).toEqual([
        expect.stringContaining("must name the id of the existing objective"),
      ]);
    });

    it("refuses an ENRICH with no description, because that would be a deletion", () => {
      const errors = errorsOf({
        items: [{ kind: "ENRICH", ref: "n1", existingId: "objective-1" }],
        summary: "One enrichment.",
      });

      expect(errors).toEqual([
        expect.stringContaining(
          "omit the item instead of clearing a description",
        ),
      ]);
    });

    it("refuses a SKIP with no reason", () => {
      const errors = errorsOf({
        items: [{ kind: "SKIP", ref: "n1" }],
        summary: "One skip.",
      });

      expect(errors).toEqual([
        expect.stringContaining(
          "must say why the objective is already covered",
        ),
      ]);
    });

    it("refuses a verdict kind it does not know", () => {
      const errors = errorsOf({
        items: [{ kind: "DELETE", ref: "n1" }],
        summary: "One deletion.",
      });

      expect(errors[0]).toContain("ADD, ENRICH, SKIP");
    });

    it("refuses a plan with no summary", () => {
      expect(errorsOf({ items: [], summary: "" })).toEqual([
        "merge.summary: must not be empty",
      ]);
    });

    it("refuses a payload that is not a plan at all", () => {
      expect(errorsOf("no").length).toBeGreaterThan(0);
      expect(errorsOf(null).length).toBeGreaterThan(0);
      expect(errorsOf({ summary: "Nothing." }).length).toBeGreaterThan(0);
    });
  });

  describe("bounds", () => {
    it("refuses more verdicts than one merge carries", () => {
      const errors = errorsOf({
        items: Array.from({ length: MAX_MERGE_ITEMS + 1 }, () => ({
          kind: "SKIP",
          ref: "n1",
          reason: "Covered.",
        })),
        summary: "Far too many.",
      });

      expect(errors[0]).toContain(String(MAX_MERGE_ITEMS));
    });

    it("refuses a title longer than the column holds", () => {
      const errors = errorsOf({
        items: [
          { kind: "ADD", ref: "n1", title: "x".repeat(MERGE_TITLE_LIMIT + 1) },
        ],
        summary: "One addition.",
      });

      expect(errors[0]).toContain(String(MERGE_TITLE_LIMIT));
    });

    it("refuses a description longer than the column holds", () => {
      const errors = errorsOf({
        items: [
          {
            kind: "ENRICH",
            ref: "n1",
            existingId: "objective-1",
            description: "x".repeat(MERGE_DESCRIPTION_LIMIT + 1),
          },
        ],
        summary: "One enrichment.",
      });

      expect(errors[0]).toContain(String(MERGE_DESCRIPTION_LIMIT));
    });
  });

  describe("applicability to what was actually sent", () => {
    it("refuses a verdict about a ref that was never offered", () => {
      // The shape is fine; the plan is about a node that does not exist. This is the check
      // that makes sender-assigned refs worth having.
      const errors = errorsOf({
        items: [{ kind: "SKIP", ref: "n9", reason: "Covered." }],
        summary: "One skip.",
      });

      expect(errors).toEqual([
        expect.stringContaining("names no extracted objective that was sent"),
      ]);
    });

    it("refuses an enrichment of an objective that was not listed", () => {
      const errors = errorsOf({
        items: [
          {
            kind: "ENRICH",
            ref: "n1",
            existingId: "objective-404",
            description: "Extended.",
          },
        ],
        summary: "One enrichment.",
      });

      expect(errors).toEqual([
        expect.stringContaining("enrich only an objective that was listed"),
      ]);
    });

    it("refuses an addition parented on an id that was not listed", () => {
      const errors = errorsOf({
        items: [
          {
            kind: "ADD",
            ref: "n1",
            title: "Quotas",
            parentExistingId: "objective-404",
          },
        ],
        summary: "One addition.",
      });

      expect(errors).toEqual([
        expect.stringContaining(
          "names no objective in the list of existing objectives",
        ),
      ]);
    });

    it("says nothing about the owner's text in any message", () => {
      const secret = "Only in the owner's own syllabus";
      const errors = errorsOf({
        items: [
          { kind: "ADD", ref: "n9", title: secret },
          {
            kind: "ENRICH",
            ref: "n1",
            existingId: "objective-404",
            description: secret,
          },
        ],
        summary: secret,
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join(" ")).not.toContain(secret);
    });
  });
});

describe("objectiveMergeValidator", () => {
  it("curries the sent tree and the described hierarchy for the gateway's one-value callback", () => {
    const validator = objectiveMergeValidator(SOURCE, EXISTING);
    const good = validator({
      items: [{ kind: "SKIP", ref: "n1", reason: "Covered." }],
      summary: "One skip.",
    });

    expect(good.ok).toBe(true);
    expect(
      validator({
        items: [{ kind: "SKIP", ref: "n9", reason: "Covered." }],
        summary: "One skip.",
      }).ok,
    ).toBe(false);
  });

  it("validates against the tree it was given, not some other one", () => {
    // The same JSON is a good plan against one extraction and an unapplicable one against
    // another, which is the whole reason the lists are arguments.
    const payload = {
      items: [{ kind: "SKIP", ref: "n1", reason: "Covered." }],
      summary: "One skip.",
    };

    expect(objectiveMergeValidator([], EXISTING)(payload).ok).toBe(false);
    expect(objectiveMergeValidator(SOURCE, EXISTING)(payload).ok).toBe(true);
  });
});

describe("readStoredMergePlan", () => {
  it("reads a plan back off the run row", () => {
    const stored = readStoredMergePlan({
      items: [{ kind: "SKIP", ref: "n1", reason: "Covered." }],
      summary: "One skip.",
    });

    expect(stored?.items).toHaveLength(1);
    expect(stored?.summary).toBe("One skip.");
  });

  it("keeps a plan that references an objective the owner has since removed", () => {
    // Deliberate asymmetry with the inbound direction: the live hierarchy may have moved on
    // between confirming and applying, and failing the whole payload would lose the entire
    // proposal rather than the one verdict that no longer applies. The apply step resolves
    // ids against the rows it is writing beside and drops what no longer resolves.
    const stored = readStoredMergePlan({
      items: [
        {
          kind: "ENRICH",
          ref: "n1",
          existingId: "objective-long-gone",
          description: "Extended.",
        },
      ],
      summary: "One enrichment.",
    });

    expect(stored?.items).toHaveLength(1);
  });

  it("keeps a plan about refs no longer being offered", () => {
    expect(
      readStoredMergePlan({
        items: [{ kind: "SKIP", ref: "n999", reason: "Covered." }],
        summary: "One skip.",
      }),
    ).not.toBeNull();
  });

  it("returns null for a row that is not a plan, rather than throwing", () => {
    // A hand-edited row should make the confirm page say the proposal cannot be read, not
    // return a 500.
    expect(readStoredMergePlan({ items: "no", summary: "x" })).toBeNull();
    expect(readStoredMergePlan(null)).toBeNull();
    expect(readStoredMergePlan("{}")).toBeNull();
  });

  it("still refuses a stored verdict missing what its kind requires", () => {
    // Shape is not negotiable in either direction: an ENRICH with no description could not be
    // applied whatever the live hierarchy looks like.
    expect(
      readStoredMergePlan({
        items: [{ kind: "ENRICH", ref: "n1", existingId: "objective-1" }],
        summary: "One enrichment.",
      }),
    ).toBeNull();
  });
});

describe("objectiveMergeJsonSchema", () => {
  it("asks for one flat array of verdicts and a summary", () => {
    const schema = objectiveMergeJsonSchema();

    expect(schema.required).toEqual(["items", "summary"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("caps the array at what a plan may carry", () => {
    expect(objectiveMergeJsonSchema().properties?.items?.maxItems).toBe(
      MAX_MERGE_ITEMS,
    );
  });

  it("offers exactly the three verdict kinds the parser accepts", () => {
    // A drift between the enum the provider is shown and the enum the schema parses would
    // spend a call to produce something that is then rejected.
    expect(itemProperties().kind?.enum).toEqual(["ADD", "ENRICH", "SKIP"]);
    expect(
      errorsOf({
        items: [{ kind: "MOVE", ref: "n1" }],
        summary: "One move.",
      })[0],
    ).toContain("ADD, ENRICH, SKIP");
  });

  it("tells the model how to reference each side, by id and by ref", () => {
    // The descriptions are the contract for this call: nothing else explains that an existing
    // objective is named by the id it was given and an addition's parent may be another
    // addition's ref.
    const properties = itemProperties();

    expect(properties.parentExistingId?.description).toContain(
      "existing objectives",
    );
    expect(properties.parentRef?.description).toContain("earlier");
    expect(properties.existingId?.description).toContain("ENRICH only");
    expect(properties.weight?.description).toContain("ADD only");
  });

  it("bounds a weight to a percentage", () => {
    expect(itemProperties().weight?.minimum).toBe(0);
    expect(itemProperties().weight?.maximum).toBe(100);
  });
});

/** The properties of one verdict in the answer shape sent to the provider. */
function itemProperties(): Readonly<Record<string, JsonSchema | undefined>> {
  return objectiveMergeJsonSchema().properties?.items?.items?.properties ?? {};
}
