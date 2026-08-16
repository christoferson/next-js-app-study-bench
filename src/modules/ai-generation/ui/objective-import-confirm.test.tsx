import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, toInvalidFormState } from "@/shared/ui/form-state";
import { applyObjectiveImportSchema } from "@/modules/ai-generation/application/schemas";
import type { ApplyObjectiveImportInput } from "@/modules/ai-generation/application/schemas";
import { ObjectiveImportAlreadyAppliedError } from "@/modules/ai-generation/domain/errors";
import { countProposedObjectives } from "@/modules/ai-generation/domain/objective-import";
import type { ProposedObjective } from "@/modules/ai-generation/domain/objective-import";
import {
  defaultCheckedMergeKeys,
  mergeItemKey,
} from "@/modules/ai-generation/domain/objective-merge";
import type {
  MergeAdd,
  MergeEnrich,
  MergeItem,
  MergeSkip,
} from "@/modules/ai-generation/domain/objective-merge";
import type {
  MergeItemView,
  ObjectiveMergeView,
} from "@/modules/ai-generation/application/objective-import-facade";
import { ObjectiveImportConfirm } from "./objective-import-confirm";

/**
 * The confirm step, driven through the real apply schema.
 *
 * What matters on this screen is that the owner can see what they are about to accept
 * and cannot accept it without saying where it came from. So the tests read the rendered
 * proposal — codes, titles, weights, nesting, or in the merge case the three groups of
 * verdicts — and check that a submission with no source type is refused rather than
 * defaulted.
 *
 * Two shapes are tested because the screen has two: a plain tree for a track that had no
 * objectives, and per-item verdicts for one that did.
 */
function node(overrides: Partial<ProposedObjective> = {}): ProposedObjective {
  return {
    code: "1",
    title: "Demo Foundations",
    description: null,
    weight: null,
    children: [],
    ...overrides,
  };
}

const OUTLINE: readonly ProposedObjective[] = [
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
      }),
      node({ code: "1.2", title: "Describe demo limits" }),
    ],
  }),
  node({ code: "2", title: "Demo Operations", weight: 60 }),
];

function validatingAction(
  onValid: (input: ApplyObjectiveImportInput) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    try {
      onValid(
        parseInput(applyObjectiveImportSchema, {
          runId: String(form.get("runId") ?? ""),
          sourceType: String(form.get("sourceType") ?? ""),
          // The same rule the Server Action applies: the marker is what separates "a merge
          // with everything unticked" from "a tree import with no checkboxes at all".
          itemKeys:
            String(form.get("itemKeys") ?? "") === "1"
              ? form.getAll("itemKey").map(String)
              : null,
        }),
      );
    } catch (error) {
      if (isDomainError(error)) {
        return toInvalidFormState(error, form);
      }
      throw error;
    }

    return IDLE_FORM_STATE;
  };
}

function renderConfirm(
  options: {
    readonly action?: ReturnType<typeof validatingAction>;
    readonly roots?: readonly ProposedObjective[];
    readonly nodeCount?: number;
    /** The reconciliation to render, or `null` for a track that had no objectives. */
    readonly merge?: ObjectiveMergeView | null;
    readonly calledModel?: boolean;
  } = {},
): void {
  const roots = options.roots ?? OUTLINE;
  const merge = options.merge ?? null;
  const nodeCount = options.nodeCount ?? countProposedObjectives(roots);

  render(
    <ObjectiveImportConfirm
      action={options.action ?? validatingAction()}
      slug="demo-track"
      runId="run-1"
      roots={roots}
      merge={merge}
      nodeCount={nodeCount}
      addableCount={merge === null ? nodeCount : merge.counts.adds}
      calledModel={options.calledModel ?? true}
    />,
  );
}

/**
 * A merge view, derived from its verdicts rather than written out by hand.
 *
 * Everything derivable — the keys, the counts, the default ticks — is computed with the
 * same domain functions the facade uses, so a fixture cannot drift from what the facade
 * actually produces. Only the labels are supplied, because those are the parts the facade
 * looks up in the database and a component test has no database.
 */
function mergeView(
  items: readonly MergeItem[],
  labels: {
    readonly parents?: Readonly<Record<string, string>>;
    readonly parentIsNew?: readonly string[];
    readonly existingTitles?: Readonly<Record<string, string>>;
    readonly existingDescriptions?: Readonly<Record<string, string>>;
    readonly summary?: string;
    readonly existingConsidered?: number;
    readonly existingTruncated?: boolean;
  } = {},
): ObjectiveMergeView {
  const views = items.map((item): MergeItemView => {
    const existingId =
      item.kind === "ENRICH"
        ? item.existingId
        : item.kind === "SKIP"
          ? item.matchedExistingId
          : null;

    return {
      item,
      key: mergeItemKey(item),
      source: null,
      parentLabel: labels.parents?.[item.ref] ?? null,
      parentIsNew: (labels.parentIsNew ?? []).includes(item.ref),
      existingTitle:
        existingId === null
          ? null
          : (labels.existingTitles?.[existingId] ?? null),
      existingDescription:
        existingId === null
          ? null
          : (labels.existingDescriptions?.[existingId] ?? null),
    };
  });

  return {
    summary:
      labels.summary ?? "Four objectives read, most of them already yours.",
    items: views,
    counts: {
      adds: items.filter((item) => item.kind === "ADD").length,
      enriches: items.filter((item) => item.kind === "ENRICH").length,
      skips: items.filter((item) => item.kind === "SKIP").length,
    },
    existingConsidered: labels.existingConsidered ?? 94,
    existingTruncated: labels.existingTruncated ?? false,
    defaultCheckedKeys: defaultCheckedMergeKeys(items),
  };
}

function addItem(overrides: Partial<MergeAdd> = {}): MergeAdd {
  return {
    kind: "ADD",
    ref: "n1",
    parentExistingId: null,
    parentRef: null,
    code: "1.3",
    title: "Describe demo quotas",
    description: null,
    weight: null,
    ...overrides,
  };
}

function enrichItem(overrides: Partial<MergeEnrich> = {}): MergeEnrich {
  return {
    kind: "ENRICH",
    ref: "n2",
    existingId: "objective-1",
    description: "What the new document adds about demo components.",
    ...overrides,
  };
}

function skipItem(overrides: Partial<MergeSkip> = {}): MergeSkip {
  return {
    kind: "SKIP",
    ref: "n3",
    reason: "Already covered by the objective you wrote yourself.",
    matchedExistingId: "objective-2",
    ...overrides,
  };
}

function applyButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Apply / });
}

describe("ObjectiveImportConfirm", () => {
  describe("the proposed tree, with no merge", () => {
    it("shows every proposed objective with its code, title, and weight", () => {
      renderConfirm();

      expect(screen.getByText("Demo Foundations")).toBeVisible();
      expect(screen.getByText("1")).toBeVisible();
      expect(screen.getByText("Weight 40%")).toBeVisible();
      expect(screen.getByText("Describe demo components")).toBeVisible();
      expect(screen.getByText("1.1")).toBeVisible();
      expect(screen.getByText("Describe demo limits")).toBeVisible();
      expect(screen.getByText("Demo Operations")).toBeVisible();
      expect(screen.getByText("Weight 60%")).toBeVisible();
    });

    it("shows the descriptions the document supplied", () => {
      renderConfirm();

      expect(
        screen.getByText("What the document says about components."),
      ).toBeVisible();
    });

    it("nests children under their parent, so the shape can be checked", () => {
      // The nesting is the part the owner is being asked to verify. A flat list of four
      // titles would hide the mistake this screen exists to catch.
      renderConfirm();

      const firstRoot = screen.getByText("Demo Foundations").closest("li");

      expect(firstRoot).not.toBeNull();
      expect(
        within(firstRoot as HTMLElement).getByText("Describe demo components"),
      ).toBeVisible();
      expect(
        within(firstRoot as HTMLElement).queryByText("Demo Operations"),
      ).toBeNull();
    });

    it("links none of the proposed objectives anywhere, because none exists yet", () => {
      renderConfirm();

      const tree = screen.getByText("Demo Foundations").closest("ul");

      expect(within(tree as HTMLElement).queryByRole("link")).toBeNull();
    });

    it("offers no per-item choice, because there is nothing to reconcile", () => {
      // The absence of the marker is what tells the action to apply the whole tree, so it
      // is asserted rather than assumed.
      renderConfirm();

      expect(screen.queryAllByRole("checkbox")).toEqual([]);
      expect(document.querySelector('input[name="itemKeys"]')).toBeNull();
    });

    it("says so when the model proposed nothing", () => {
      renderConfirm({ roots: [], nodeCount: 0 });

      expect(
        screen.getByText(/found no objectives in that document/),
      ).toBeVisible();
    });

    it("counts the objectives on the button, so the number is on the action itself", () => {
      renderConfirm({ nodeCount: 4 });

      expect(applyButton()).toHaveTextContent("Apply 4 objectives");
    });

    it("says objective in the singular for a one-objective outline", () => {
      renderConfirm({ roots: [node()], nodeCount: 1 });

      expect(applyButton()).toHaveTextContent("Apply 1 objective");
    });

    it("says nothing was read when a deterministic reader recognised no file", () => {
      // A different sentence from the model's, because the fix is different: the model
      // answering "no outline here" is an answer, whereas no file being recognised is a
      // role the owner can set.
      renderConfirm({ roots: [], nodeCount: 0, calledModel: false });

      expect(screen.getByText(/each file has the right role/)).toBeVisible();
    });
  });

  /**
   * The merge, grouped by verdict.
   *
   * Three groups, because they are three different things happening to the owner's
   * outline, and the counts are in the headings so the shape of the merge is readable
   * before any single row is.
   */
  describe("a merge into an existing outline", () => {
    const MERGE = mergeView(
      [
        addItem({ ref: "n1", title: "Describe demo quotas" }),
        addItem({
          ref: "n2",
          title: "Describe demo throttling",
          parentExistingId: "objective-9",
        }),
        enrichItem({ ref: "n3" }),
        skipItem({ ref: "n4" }),
        skipItem({
          ref: "n5",
          reason: "Word for word what you already have.",
          matchedExistingId: "objective-3",
        }),
      ],
      {
        parents: { n2: "Demo Operations" },
        existingTitles: {
          "objective-1": "Describe demo components",
          "objective-2": "Describe demo limits",
          "objective-3": "Demo Foundations",
        },
        existingDescriptions: {
          "objective-1": "The short note the owner made.",
        },
      },
    );

    it("states the model's own summary of the reconciliation", () => {
      renderConfirm({ merge: MERGE });

      expect(screen.getByText(/most of them already yours/)).toBeVisible();
    });

    it("groups the verdicts and counts each group in its heading", () => {
      renderConfirm({ merge: MERGE });

      expect(
        screen.getByRole("heading", { name: "Will add (2)" }),
      ).toBeVisible();
      expect(
        screen.getByRole("heading", { name: "Will enrich (1)" }),
      ).toBeVisible();
      expect(screen.getByText(/Skipped \(2\)/)).toBeVisible();
    });

    it("names where each addition will land, existing parent or new one", () => {
      // "Under your existing X" and "under the new X" are different promises, and getting
      // them the wrong way round is exactly the mistake the owner is checking for.
      renderConfirm({ merge: MERGE });

      expect(screen.getByText(/as a new top-level objective/)).toBeVisible();
      expect(
        screen.getByText(/under your existing "Demo Operations"/),
      ).toBeVisible();
    });

    it("says when an addition sits under another addition", () => {
      renderConfirm({
        merge: mergeView(
          [
            addItem({ ref: "n1", title: "Demo Quotas" }),
            addItem({
              ref: "n2",
              title: "Describe soft quotas",
              parentRef: "n1",
            }),
          ],
          { parents: { n2: "Demo Quotas" }, parentIsNew: ["n2"] },
        ),
      });

      expect(screen.getByText(/under the new "Demo Quotas"/)).toBeVisible();
    });

    it("shows an enrichment as the description before and after", () => {
      renderConfirm({ merge: MERGE });

      expect(screen.getByText(/The short note the owner made/)).toBeVisible();
      expect(
        screen.getByText(/What the new document adds about demo components/),
      ).toBeVisible();
    });

    it("says an existing objective has no description when it has none", () => {
      renderConfirm({
        merge: mergeView([enrichItem()], {
          existingTitles: { "objective-1": "Describe demo components" },
        }),
      });

      expect(screen.getByText(/Now: no description/)).toBeVisible();
    });

    it("collapses the skips but keeps them reachable, with their reasons", async () => {
      // Usually the largest group and never the interesting one, so it starts closed —
      // but a wrong skip is invisible from the counts alone, so it must be one click away
      // rather than gone.
      renderConfirm({ merge: MERGE });

      const reason = screen.getByText(
        /Already covered by the objective you wrote yourself/,
      );

      expect(reason).not.toBeVisible();

      await userEvent.setup().click(screen.getByText(/Skipped \(2\)/));

      expect(reason).toBeVisible();
      expect(
        screen.getByText(/Word for word what you already have/),
      ).toBeVisible();
      expect(screen.getByText("Matched: Describe demo limits")).toBeVisible();
    });

    it("gives a skip no checkbox, because there is nothing to do to it", () => {
      // A checkbox that did nothing would be worse than none: it would imply the owner
      // could turn a duplicate into an addition from this screen.
      renderConfirm({ merge: MERGE });

      // Five verdicts, three boxes: two additions and one enrichment.
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    });

    it("ticks every addition and enrichment by default", () => {
      // The owner uploaded the document in order to get these, so the default is yes —
      // and each one is individually removable, which is what makes the default safe.
      renderConfirm({ merge: MERGE });

      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];

      expect(boxes.every((box) => box.checked)).toBe(true);
      expect(boxes.map((box) => box.value)).toEqual([
        "add:n1",
        "add:n2",
        "enrich:n3",
      ]);
    });

    it("submits only the items left ticked", async () => {
      const onValid = vi.fn();

      renderConfirm({ merge: MERGE, action: validatingAction(onValid) });

      const user = userEvent.setup();

      await user.click(screen.getByRole("checkbox", { name: /demo quotas/i }));
      await user.click(
        screen.getByRole("radio", { name: /Official syllabus/ }),
      );
      await user.click(applyButton());

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        runId: "run-1",
        sourceType: "OFFICIAL_SYLLABUS",
        itemKeys: ["add:n2", "enrich:n3"],
      });
    });

    it("submits an empty list rather than nothing when everything is unticked", async () => {
      // The distinction the marker exists for: an empty list is "I declined all of it",
      // which the facade refuses, and `null` would be "apply everything".
      const onValid = vi.fn();

      renderConfirm({ merge: MERGE, action: validatingAction(onValid) });

      const user = userEvent.setup();

      for (const box of screen.getAllByRole("checkbox")) {
        await user.click(box);
      }

      await user.click(
        screen.getByRole("radio", { name: /Official syllabus/ }),
      );
      await user.click(applyButton());

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]?.itemKeys).toEqual([]);
    });

    it("counts changes rather than objectives on the button", () => {
      // Two additions and an enrichment are not three objectives: one of them is a
      // rewrite of something that already exists.
      renderConfirm({ merge: MERGE });

      expect(applyButton()).toHaveTextContent("Apply 3 changes");
    });

    it("offers no apply at all when every verdict is a skip", () => {
      renderConfirm({ merge: mergeView([skipItem()]) });

      expect(
        screen.getByRole("button", { name: /Nothing left to add/ }),
      ).toBeDisabled();
      expect(
        screen.getByText(/already on this track, so there is nothing to add/),
      ).toBeVisible();
    });

    it("warns when the track was too large to compare against in full", () => {
      // The owner has to be able to find out that the merge did not see their last forty
      // objectives, because a duplicate added under a section it never read looks like a
      // bug in the merge rather than a bound on it.
      renderConfirm({
        merge: mergeView([addItem()], {
          existingTruncated: true,
          existingConsidered: 300,
        }),
      });

      expect(
        screen.getByText(/first 300 of them/, { selector: "p" }),
      ).toBeVisible();
    });

    it("says an enrichment target is gone when it no longer resolves", () => {
      // An objective archived between the merge and the confirm page. The verdict is shown
      // with the truth about it rather than dropped, because the apply drops it for real.
      renderConfirm({ merge: mergeView([enrichItem()]) });

      expect(
        screen.getByText(/no longer on the track and will be left out/),
      ).toBeVisible();
    });
  });

  describe("the source-type choice", () => {
    it("offers the official and unofficial choices and preselects neither", () => {
      // Preselecting "official" would let an unchecked model outline into the bank
      // labelled as the published guide by nothing more than a hurried click.
      renderConfirm();

      const radios = screen.getAllByRole("radio");

      expect(radios).toHaveLength(2);
      expect(
        radios.every((radio) => !(radio as HTMLInputElement).checked),
      ).toBe(true);
      expect(
        screen.getByRole("radio", { name: /Official syllabus/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /Unofficial or AI-assisted/ }),
      ).toBeInTheDocument();
    });

    it("explains what each choice claims", () => {
      renderConfirm();

      expect(
        screen.getByRole("radio", { name: /official exam guide/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", {
          name: /not yet checked against an official guide/,
        }),
      ).toBeInTheDocument();
    });

    it("submits the owner's choice with the run it belongs to", async () => {
      const onValid = vi.fn();

      renderConfirm({ action: validatingAction(onValid) });

      const user = userEvent.setup();

      await user.click(
        screen.getByRole("radio", { name: /Official syllabus/ }),
      );
      await user.click(applyButton());

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        runId: "run-1",
        sourceType: "OFFICIAL_SYLLABUS",
        itemKeys: null,
      });
    });

    it("submits the unofficial choice when that is what was chosen", async () => {
      const onValid = vi.fn();

      renderConfirm({ action: validatingAction(onValid) });

      const user = userEvent.setup();

      await user.click(
        screen.getByRole("radio", { name: /Unofficial or AI-assisted/ }),
      );
      await user.click(applyButton());

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]?.sourceType).toBe("AI_PROPOSED");
    });

    it("refuses to apply with no choice made", async () => {
      const onValid = vi.fn();

      renderConfirm({ action: validatingAction(onValid) });

      await userEvent.setup().click(applyButton());

      await waitFor(() => {
        expect(
          screen.getByText(
            "Choose whether this outline is the official syllabus or unofficial.",
          ),
        ).toBeVisible();
      });

      expect(onValid).not.toHaveBeenCalled();
    });
  });

  describe("discarding", () => {
    it("offers a way out that goes to the track and cannot submit", () => {
      // A link rather than a button, and that is the assertion: discard writes nothing,
      // so it must not be a submission. Anything inside a form that is not explicitly a
      // link would post the apply request.
      renderConfirm();

      expect(screen.getByRole("link", { name: "Discard" })).toHaveAttribute(
        "href",
        "/study-tracks/demo-track",
      );
      expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    });

    it("says what applying and discarding each do", () => {
      renderConfirm();

      expect(
        screen.getByText(/Discarding adds nothing at all/),
      ).toHaveTextContent("stays in your run history either way");
    });

    it("promises that a merge leaves everything unticked alone", () => {
      renderConfirm({ merge: mergeView([addItem(), enrichItem()]) });

      expect(
        screen.getByText(/Applying writes only what is ticked/),
      ).toHaveTextContent("left exactly as it is");
    });
  });

  describe("a run that was already applied", () => {
    it("reports the refusal at the form level rather than on a field", async () => {
      // Reachable from a stale tab. The message has no field to sit beside, and it has to
      // say that nothing was added twice — the owner's fear at that moment is duplicates.
      renderConfirm({
        action: validatingAction(() => {
          throw new ObjectiveImportAlreadyAppliedError("run-1");
        }),
      });

      const user = userEvent.setup();

      await user.click(
        screen.getByRole("radio", { name: /Official syllabus/ }),
      );
      await user.click(applyButton());

      await waitFor(() => {
        expect(
          screen.getByText(/already been added to the track/),
        ).toHaveTextContent("nothing was added again");
      });
    });
  });
});
