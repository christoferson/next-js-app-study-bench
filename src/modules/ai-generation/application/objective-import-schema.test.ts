import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_DEPTH,
  MAX_IMPORT_NODES,
} from "@/modules/ai-generation/domain/objective-import";
import type { ProposedObjectiveTree } from "@/modules/ai-generation/domain/objective-import";
import {
  objectiveImportJsonSchema,
  readProposedTree,
  serializeProposedTree,
  validateProposedObjectives,
} from "./objective-import-schema";

/**
 * The objective-import output contract.
 *
 * Every payload here is synthetic — an invented certification with invented domains —
 * because no real exam guide's text belongs in this repository. That costs nothing: the
 * assertions are about shape, caps, and coercion, none of which depend on the words.
 *
 * Two properties get the most attention. A tree that violates a cap must be *rejected*
 * rather than silently trimmed, because a trimmed outline is one the owner would confirm
 * without knowing what was dropped. And no validation message may contain document text,
 * because those messages travel back to the provider as repair feedback.
 */

/** One well-formed node, as a model would answer. */
function node(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    code: "1",
    title: "Demo Foundations",
    description: null,
    weight: 40,
    children: [],
    ...overrides,
  };
}

function payload(nodes: readonly unknown[]): unknown {
  return { objectives: nodes };
}

/** A chain `depth` levels deep, for testing the depth cap. */
function chain(depth: number): Record<string, unknown> {
  return depth <= 1
    ? node({ code: `level-${depth}`, children: [] })
    : node({ code: `level-${depth}`, children: [chain(depth - 1)] });
}

function accepted(value: unknown): ProposedObjectiveTree {
  const result = validateProposedObjectives(value);

  if (!result.ok) {
    throw new Error(`Expected a valid tree, got: ${result.errors.join("; ")}`);
  }

  return result.value;
}

function rejection(value: unknown): readonly string[] {
  const result = validateProposedObjectives(value);

  if (result.ok) {
    throw new Error("Expected the tree to be rejected.");
  }

  return result.errors;
}

describe("validateProposedObjectives", () => {
  it("accepts a nested outline with codes, weights, and descriptions", () => {
    const tree = accepted(
      payload([
        node({
          code: "1",
          title: "Demo Foundations",
          weight: 40,
          children: [
            node({
              code: "1.1",
              title: "Describe demo components",
              description: "What the document says about components.",
              weight: null,
              children: [],
            }),
          ],
        }),
        node({ code: "2", title: "Demo Operations", weight: 60 }),
      ]),
    );

    expect(tree.roots).toHaveLength(2);
    expect(tree.roots[0]?.title).toBe("Demo Foundations");
    expect(tree.roots[0]?.weight).toBe(40);
    expect(tree.roots[0]?.children[0]?.code).toBe("1.1");
    expect(tree.roots[0]?.children[0]?.description).toBe(
      "What the document says about components.",
    );
    expect(tree.roots[1]?.children).toEqual([]);
  });

  it("treats an omitted code, description, weight, and child list as absent", () => {
    // A model that answers only the required field is answering correctly, and a
    // required-everything schema would reject an outline for having no weights.
    const tree = accepted(
      payload([{ title: "Demo domain with nothing else" }]),
    );

    expect(tree.roots[0]).toEqual({
      code: null,
      title: "Demo domain with nothing else",
      description: null,
      weight: null,
      children: [],
    });
  });

  it("reads a weight a model quoted or wrote with a percent sign", () => {
    const tree = accepted(
      payload([
        node({ code: "1", weight: "40" }),
        node({ code: "2", weight: "60 %" }),
      ]),
    );

    expect(tree.roots.map((root) => root.weight)).toEqual([40, 60]);
  });

  it("trims surrounding whitespace out of extracted text", () => {
    // Extracted PDF text arrives with stray spacing, and an objective whose title
    // begins with a space would sort and display wrongly for the life of the track.
    const tree = accepted(
      payload([node({ code: "  1.1  ", title: "  Demo domain  " })]),
    );

    expect(tree.roots[0]?.code).toBe("1.1");
    expect(tree.roots[0]?.title).toBe("Demo domain");
  });

  it("accepts an outline with no objectives, because some documents have none", () => {
    // Deliberate, and learned the hard way: a live extraction against a page of prose
    // returned one objective titled "No objectives found in document", because the
    // schema had left the model no way to say "there is no outline here". Emptiness has
    // to be expressible or it gets fabricated. Nothing can be applied from it — the
    // apply step refuses an empty tree and the confirm page says the document had no
    // outline — so accepting it costs nothing and buys a truthful answer.
    expect(accepted(payload([])).roots).toEqual([]);
  });

  it("rejects an empty title, which is the one thing an objective cannot lack", () => {
    expect(rejection(payload([node({ title: "   " })])).join(" ")).toContain(
      "title: must not be empty",
    );
  });

  it(`rejects a tree deeper than ${MAX_IMPORT_DEPTH} levels rather than trimming it`, () => {
    // The distinction this asserts is the important one. Silently dropping the fourth
    // level would show the owner a tree that looks complete, and they would confirm it
    // without knowing that every leaf had been discarded.
    expect(
      rejection(payload([chain(MAX_IMPORT_DEPTH + 1)])).join(" "),
    ).toContain(`deeper than the ${MAX_IMPORT_DEPTH} levels accepted`);
  });

  it(`accepts a tree exactly ${MAX_IMPORT_DEPTH} levels deep`, () => {
    const tree = accepted(payload([chain(MAX_IMPORT_DEPTH)]));

    expect(tree.roots[0]?.children[0]?.children).toHaveLength(1);
  });

  it(`rejects more than ${MAX_IMPORT_NODES} objectives`, () => {
    const roots = Array.from(
      { length: MAX_IMPORT_NODES + 1 },
      (_unused, index) =>
        node({ code: `code-${index}`, title: `Demo objective ${index}` }),
    );

    expect(rejection(payload(roots)).join(" ")).toMatch(
      /list 150 objectives or fewer|at most 150/,
    );
  });

  it("rejects two siblings sharing one code", () => {
    // A repeated code in one group means the model merged two pages or looped. Left in,
    // it would produce two objectives the owner cannot tell apart.
    expect(
      rejection(
        payload([
          node({ code: "1.1", title: "Demo first" }),
          node({ code: "1.1", title: "Demo second" }),
        ]),
      ).join(" "),
    ).toContain("share one code");
  });

  it("allows the same code in different groups, which real syllabuses do", () => {
    const tree = accepted(
      payload([
        node({
          code: "1",
          children: [node({ code: "1.1", title: "Demo child of one" })],
        }),
        node({
          code: "2",
          children: [node({ code: "1.1", title: "Demo child of two" })],
        }),
      ]),
    );

    expect(tree.roots).toHaveLength(2);
  });

  it("rejects a weight outside 0 to 100", () => {
    expect(rejection(payload([node({ weight: 140 })])).join(" ")).toContain(
      "must be between 0 and 100",
    );
    expect(rejection(payload([node({ weight: -1 })])).join(" ")).toContain(
      "must be between 0 and 100",
    );
  });

  it("rejects a weight that is not a number at all", () => {
    expect(
      rejection(payload([node({ weight: "about a third" })])).join(" "),
    ).toContain("must be a number or omitted");
  });

  it("rejects a payload that is not the expected object", () => {
    expect(rejection({ objectives: "not an array" }).length).toBeGreaterThan(0);
    expect(rejection(null).length).toBeGreaterThan(0);
    expect(rejection({}).length).toBeGreaterThan(0);
  });

  it("never puts document text in a rejection message", () => {
    // The messages are repair feedback, so they go back to the provider. A message
    // quoting the failing value would send a second copy of the owner's document.
    const secret = "CONFIDENTIAL-DEMO-SYLLABUS-TEXT";
    const messages = rejection(
      payload([
        node({ title: "   ", description: secret, weight: "not a number" }),
        node({ title: secret.repeat(20) }),
      ]),
    ).join("\n");

    expect(messages).not.toContain(secret);
  });
});

describe("storing and reading a proposal", () => {
  it("round-trips a tree through the run row", () => {
    const tree = accepted(
      payload([
        node({
          code: "1",
          weight: 40,
          children: [node({ code: "1.1", title: "Demo child" })],
        }),
      ]),
    );

    expect(readProposedTree(serializeProposedTree(tree))).toEqual(tree);
  });

  it("reads nothing from a run that proposed nothing", () => {
    expect(readProposedTree(null)).toBeNull();
  });

  it("reads nothing from a payload that is not JSON", () => {
    expect(readProposedTree("{not json")).toBeNull();
  });

  it("re-validates on read, so a hand-edited row cannot be applied", () => {
    // Rows are untrusted input too. An edited payload fails here rather than becoming
    // an objective with an empty title in the owner's tree.
    expect(
      readProposedTree(JSON.stringify({ objectives: [{ title: "" }] })),
    ).toBeNull();
  });

  it("reads an empty proposal back as empty rather than as unreadable", () => {
    // A document with no outline is a real, readable answer. The confirm page needs to
    // tell it apart from a row it could not parse, because they say different things to
    // the owner: "that document had no outline" against "this proposal is broken".
    expect(readProposedTree(JSON.stringify({ objectives: [] }))?.roots).toEqual(
      [],
    );
  });
});

describe("objectiveImportJsonSchema", () => {
  it(`describes the nesting explicitly, ${MAX_IMPORT_DEPTH} levels and no deeper`, () => {
    // Written out rather than a self-reference, so the shape the provider is shown
    // cannot express a tree that would be rejected for depth.
    const schema = objectiveImportJsonSchema();
    const root = schema.properties?.objectives;
    const level1 = root?.items;
    const level2 = level1?.properties?.children?.items;
    const level3 = level2?.properties?.children?.items;

    expect(root?.type).toBe("array");
    expect(level1?.required).toEqual(["title"]);
    expect(level2).toBeDefined();
    expect(level3).toBeDefined();
    expect(level3?.properties?.children).toBeUndefined();
  });

  it("caps the array sizes it advertises", () => {
    expect(objectiveImportJsonSchema().properties?.objectives?.maxItems).toBe(
      MAX_IMPORT_NODES,
    );
  });
});
