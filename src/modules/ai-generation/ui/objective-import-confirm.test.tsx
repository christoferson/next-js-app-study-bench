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
import type { ProposedObjective } from "@/modules/ai-generation/domain/objective-import";
import { ObjectiveImportConfirm } from "./objective-import-confirm";

/**
 * The confirm step, driven through the real apply schema.
 *
 * What matters on this screen is that the owner can see what they are about to accept
 * and cannot accept it without saying where it came from. So the tests read the rendered
 * tree — codes, titles, weights, nesting — and check that a submission with no source
 * type is refused rather than defaulted.
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
  } = {},
): void {
  const roots = options.roots ?? OUTLINE;

  render(
    <ObjectiveImportConfirm
      action={options.action ?? validatingAction()}
      slug="demo-track"
      runId="run-1"
      roots={roots}
      nodeCount={options.nodeCount ?? 4}
    />,
  );
}

function applyButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Apply / });
}

describe("ObjectiveImportConfirm", () => {
  describe("the proposed tree", () => {
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
