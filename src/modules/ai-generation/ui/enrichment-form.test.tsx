import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, toInvalidFormState } from "@/shared/ui/form-state";
import { enrichmentRequestSchema } from "@/modules/ai-generation/application/schemas";
import type { EnrichmentRequestInput } from "@/modules/ai-generation/application/schemas";
import { MAX_ENRICHMENT_ITEMS } from "@/modules/ai-generation/domain/generation-limits";
import { personaForStudyType } from "@/modules/ai-generation/domain/personas";
import { EnrichmentForm } from "./enrichment-form";

/**
 * The enrichment form, driven through the real request schema.
 *
 * As with the generate form, the action here is the pair a Server Action runs, so a
 * request the schema refuses is reported next to the field that caused it and an
 * accepted one is asserted as the value the facade would receive.
 */
function validatingAction(
  onValid: (input: EnrichmentRequestInput) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    const read = (field: string): string => String(form.get(field) ?? "");

    try {
      onValid(
        parseInput(enrichmentRequestSchema, {
          count: read("count"),
          additionalInstructions: read("additionalInstructions"),
          generateAnyway: read("generateAnyway"),
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

const HSK = personaForStudyType("LANGUAGE_PROFICIENCY");

function renderForm(
  options: {
    readonly action?: ReturnType<typeof validatingAction>;
    readonly unenrichedCount?: number;
    readonly generateAnyway?: boolean;
  } = {},
): void {
  render(
    <EnrichmentForm
      action={options.action ?? validatingAction()}
      slug="demo-hsk"
      persona={HSK}
      unenrichedCount={options.unenrichedCount ?? 40}
      maxItemCount={MAX_ENRICHMENT_ITEMS}
      modelProvider="fake"
      modelId="fake-deterministic"
      {...(options.generateAnyway === undefined
        ? {}
        : { generateAnyway: options.generateAnyway })}
    />,
  );
}

describe("EnrichmentForm", () => {
  describe("what it offers", () => {
    it("asks how many cards and nothing else about which", () => {
      renderForm();

      expect(screen.getByLabelText(/how many cards/i)).toBeInTheDocument();
      // Which cards is not a choice: the run walks the bank in its own order, and a
      // picker would be a way to enrich the same card twice.
      expect(screen.queryByRole("checkbox", { name: /card/i })).toBeNull();
      expect(screen.queryByLabelText("Difficulty")).toBeNull();
    });

    it("defaults to a full run and caps the field at the run's own limit", () => {
      renderForm();

      const count = screen.getByLabelText(/how many cards/i);

      expect(count).toHaveValue(MAX_ENRICHMENT_ITEMS);
      expect(count).toHaveAttribute("max", String(MAX_ENRICHMENT_ITEMS));
      expect(count).toHaveAttribute("min", "1");
    });

    it("never offers more cards than are left to do", () => {
      // Asking for twenty when four remain would produce a run reporting sixteen
      // failures for having nothing to do.
      renderForm({ unenrichedCount: 4 });

      const count = screen.getByLabelText(/how many cards/i);

      expect(count).toHaveValue(4);
      expect(count).toHaveAttribute("max", "4");
      expect(screen.getByText(/Between 1 and 4\./)).toBeVisible();
    });

    it("says the run continues where the last one stopped", () => {
      renderForm();

      expect(
        screen.getByText(/running this again continues where it left off/),
      ).toBeVisible();
    });

    it("names the persona and model that will be billed", () => {
      renderForm();

      expect(
        screen.getByText(/Persona: HSK Chinese proficiency, version 1\./),
      ).toBeVisible();
      expect(screen.getByText("fake-deterministic")).toBeVisible();
    });

    it("promises a new revision rather than a replacement", () => {
      renderForm();

      expect(
        screen.getByText(/gains a new revision with the extra detail/),
      ).toHaveTextContent("nothing you wrote is replaced");
    });

    it("says notes cannot change the instructions", () => {
      renderForm();

      expect(
        screen.getByText(
          /they cannot change what the model is instructed to do/i,
        ),
      ).toBeVisible();
    });

    it("cannot be submitted when there is nothing left to enrich", () => {
      renderForm({ unenrichedCount: 0 });

      expect(
        screen.getByRole("button", { name: "Enrich with AI" }),
      ).toBeDisabled();
    });

    it("offers the duplicate confirmation only when there is a duplicate", () => {
      renderForm();

      expect(
        screen.queryByRole("checkbox", { name: /again anyway/ }),
      ).toBeNull();
    });

    it("pre-ticks the confirmation when the owner has just seen the notice", () => {
      renderForm({ generateAnyway: true });

      expect(
        screen.getByRole("checkbox", { name: /again anyway/ }),
      ).toBeChecked();
    });
  });

  describe("what it submits", () => {
    it("submits the request as the facade will receive it", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid) });

      const user = userEvent.setup();
      const count = screen.getByLabelText(/how many cards/i);

      await user.clear(count);
      await user.type(count, "5");
      await user.type(
        screen.getByLabelText(/your notes/i),
        "note formal versus spoken register",
      );
      await user.click(screen.getByRole("button", { name: "Enrich with AI" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        count: 5,
        additionalInstructions: "note formal versus spoken register",
        generateAnyway: false,
      });
    });

    it("submits with no notes when the owner adds none", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid) });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Enrich with AI" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        count: MAX_ENRICHMENT_ITEMS,
        additionalInstructions: null,
        generateAnyway: false,
      });
    });

    it("submits the confirmation the notice asked for", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid), generateAnyway: true });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Enrich with AI" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]?.generateAnyway).toBe(true);
    });
  });

  describe("what it refuses", () => {
    it("reports a count past the enrichment cap on the count field", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid) });

      const user = userEvent.setup();
      const count = screen.getByLabelText(/how many cards/i);

      await user.clear(count);
      await user.type(count, "50");
      await user.click(screen.getByRole("button", { name: "Enrich with AI" }));

      await waitFor(() => {
        expect(
          screen.getByText(
            `Enrich between 1 and ${MAX_ENRICHMENT_ITEMS} cards.`,
          ),
        ).toBeVisible();
      });

      expect(onValid).not.toHaveBeenCalled();
      expect(count).toHaveAttribute("aria-invalid", "true");
    });

    it("reports an empty count rather than assuming a run size", async () => {
      renderForm();

      const user = userEvent.setup();

      await user.clear(screen.getByLabelText(/how many cards/i));
      await user.click(screen.getByRole("button", { name: "Enrich with AI" }));

      await waitFor(() => {
        expect(
          screen.getByText(
            `Enrich between 1 and ${MAX_ENRICHMENT_ITEMS} cards.`,
          ),
        ).toBeVisible();
      });
    });

    it("keeps what the owner typed when the request is refused", async () => {
      renderForm();

      const user = userEvent.setup();
      const count = screen.getByLabelText(/how many cards/i);

      await user.clear(count);
      await user.type(count, "99");
      await user.type(
        screen.getByLabelText(/your notes/i),
        "note the register",
      );
      await user.click(screen.getByRole("button", { name: "Enrich with AI" }));

      await waitFor(() => {
        expect(
          screen.getByText(
            `Enrich between 1 and ${MAX_ENRICHMENT_ITEMS} cards.`,
          ),
        ).toBeVisible();
      });

      expect(screen.getByLabelText(/your notes/i)).toHaveValue(
        "note the register",
      );
    });

    it("reports over-long notes on the notes field", async () => {
      renderForm();

      const user = userEvent.setup();
      const notes = screen.getByLabelText(/your notes/i);

      await user.click(notes);
      await user.paste("x".repeat(1001));
      await user.click(screen.getByRole("button", { name: "Enrich with AI" }));

      await waitFor(() => {
        expect(screen.getByText("Use 1000 characters or fewer.")).toBeVisible();
      });
    });
  });
});
