import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  certificationInputSchema,
  parseInput,
} from "@/modules/certifications/application/schemas";
import { isDomainError } from "@/modules/certifications/domain/errors";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import { CertificationForm } from "./certification-form";
import type { FormState } from "./form-state";
import { toInvalidFormState } from "./form-state";

/**
 * The action under test is the real validation path: the same schema the Server
 * Action uses, wrapped so the test can assert what the owner sees. Only the
 * `redirect`/`revalidatePath` side of the action is left out.
 */
function validatingAction(
  onValid: (values: Record<string, string>) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    const submitted = Object.fromEntries(
      [...form.entries()].map(([key, value]) => [key, String(value)]),
    );

    try {
      parseInput(certificationInputSchema, submitted);
    } catch (error) {
      if (isDomainError(error)) {
        return toInvalidFormState(error, form);
      }
      throw error;
    }

    onValid(submitted);

    return { status: "idle", fieldErrors: {}, values: {} };
  };
}

function renderCreateForm(
  action = validatingAction(),
): ReturnType<typeof render> {
  return render(
    <CertificationForm
      action={action}
      submitLabel="Create study track"
      cancelHref="/"
    />,
  );
}

describe("CertificationForm", () => {
  it("labels every field", () => {
    renderCreateForm();

    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Provider/)).toBeInTheDocument();
    expect(screen.getByLabelText("Exam code")).toBeInTheDocument();
    expect(screen.getByLabelText("Version")).toBeInTheDocument();
    expect(screen.getByLabelText("Study type")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Target date")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority")).toBeInTheDocument();
    expect(screen.getByLabelText("Default session length")).toBeInTheDocument();
  });

  it("offers the SPEC 6.1 study types only", () => {
    renderCreateForm();

    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(options).toContain("Technical certification");
    expect(options).toContain("Language proficiency");
    expect(options).toContain("General");
    expect(options).not.toContain("Certification");
    expect(options).not.toContain("Language examination");
  });

  it("shows a server-side validation message beside the offending field", async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/^Provider/), "Demo Provider");
    await user.click(
      screen.getByRole("button", { name: "Create study track" }),
    );

    const nameField = screen.getByLabelText(/^Name/);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Name is required.");
    });
    expect(nameField).toHaveAttribute("aria-invalid", "true");
    expect(nameField.getAttribute("aria-describedby")).toContain("name-error");
  });

  it("keeps what the owner typed after a rejected submission", async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/^Name/), "Kept Name");
    await user.click(
      screen.getByRole("button", { name: "Create study track" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Kept Name");
  });

  it("submits normalised values when the form is valid", async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    renderCreateForm(validatingAction(onValid));

    await user.type(screen.getByLabelText(/^Name/), "Demo Track");
    await user.type(screen.getByLabelText(/^Provider/), "Demo Provider");
    await user.click(
      screen.getByRole("button", { name: "Create study track" }),
    );

    await waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(1);
    });
    expect(onValid.mock.calls[0]?.[0]).toMatchObject({
      name: "Demo Track",
      provider: "Demo Provider",
      studyType: "TECHNICAL_CERTIFICATION",
      priority: "3",
      defaultSessionMinutes: "20",
    });
  });

  it("reports an out-of-range session length against its own field", async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/^Name/), "Demo Track");
    await user.type(screen.getByLabelText(/^Provider/), "Demo Provider");
    await user.clear(screen.getByLabelText("Default session length"));
    await user.type(screen.getByLabelText("Default session length"), "1");
    await user.click(
      screen.getByRole("button", { name: "Create study track" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /session length between 5 and 240/i,
      );
    });
  });

  it("pre-fills the form when editing an existing track", () => {
    render(
      <CertificationForm
        action={validatingAction()}
        submitLabel="Save changes"
        cancelHref="/study-tracks/demo-cloud-practitioner"
        certification={certificationFixture({
          name: "Existing Track",
          targetDate: "2026-12-01",
          priority: 1,
        })}
      />,
    );

    expect(screen.getByLabelText(/^Name/)).toHaveValue("Existing Track");
    expect(screen.getByLabelText("Target date")).toHaveValue("2026-12-01");
    expect(screen.getByLabelText("Priority")).toHaveValue("1");
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  /**
   * The persona field, which this module deliberately knows almost nothing about.
   *
   * The component takes `{ id, label }` pairs rather than a persona type: the identifier
   * is opaque here and resolved by the ai-generation module, and importing its type would
   * reverse the dependency the boundary test pins.
   */
  describe("the persona field", () => {
    const CHOICES = [
      { id: "persona-1", label: "My AWS instructor" },
      { id: "persona-2", label: "My second instructor" },
    ];

    it("offers automatic plus every persona it was given", () => {
      render(
        <CertificationForm
          action={validatingAction()}
          submitLabel="Create study track"
          cancelHref="/"
          personaChoices={CHOICES}
        />,
      );

      const options = [
        ...screen.getByLabelText("Persona").querySelectorAll("option"),
      ].map((option) => option.textContent);

      expect(options).toEqual([
        "Automatic (by study type)",
        "My AWS instructor",
        "My second instructor",
      ]);
    });

    it("defaults a new track to automatic", () => {
      render(
        <CertificationForm
          action={validatingAction()}
          submitLabel="Create study track"
          cancelHref="/"
          personaChoices={CHOICES}
        />,
      );

      expect(screen.getByLabelText("Persona")).toHaveValue("");
    });

    it("pre-selects the track's own assignment when editing", () => {
      render(
        <CertificationForm
          action={validatingAction()}
          submitLabel="Save changes"
          cancelHref="/study-tracks/demo-cloud-practitioner"
          certification={certificationFixture({ personaId: "persona-2" })}
          personaChoices={CHOICES}
        />,
      );

      expect(screen.getByLabelText("Persona")).toHaveValue("persona-2");
    });

    it("submits the chosen persona", async () => {
      const user = userEvent.setup();
      const onValid = vi.fn();

      render(
        <CertificationForm
          action={validatingAction(onValid)}
          submitLabel="Create study track"
          cancelHref="/"
          personaChoices={CHOICES}
        />,
      );

      await user.type(screen.getByLabelText(/^Name/), "Demo Track");
      await user.type(screen.getByLabelText(/^Provider/), "Demo Provider");
      await user.selectOptions(
        screen.getByLabelText("Persona"),
        "My second instructor",
      );
      await user.click(
        screen.getByRole("button", { name: "Create study track" }),
      );

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });
      expect(onValid.mock.calls[0]?.[0]).toMatchObject({
        personaId: "persona-2",
      });
    });

    it("shows the field with Automatic and a create-personas hint when the owner has none", async () => {
      // Always visible: a field that only appears once a persona exists is
      // undiscoverable — the empty state is where the owner learns personas exist.
      const user = userEvent.setup();
      const onValid = vi.fn();

      render(
        <CertificationForm
          action={validatingAction(onValid)}
          submitLabel="Create study track"
          cancelHref="/"
        />,
      );

      const select = screen.getByLabelText("Persona");

      expect(select).toBeVisible();
      expect(
        screen.getByRole("option", { name: "Automatic (by study type)" }),
      ).toBeVisible();
      expect(screen.getByText(/create your own under personas/i)).toBeVisible();

      await user.type(screen.getByLabelText(/^Name/), "Demo Track");
      await user.type(screen.getByLabelText(/^Provider/), "Demo Provider");
      await user.click(
        screen.getByRole("button", { name: "Create study track" }),
      );

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });
      expect(onValid.mock.calls[0]?.[0]).toMatchObject({ personaId: "" });
    });

    it("keeps an existing assignment when no choices can be offered", () => {
      // A language track whose owner has only technical personas: the assignment it
      // already has must survive a save from this form, offered as a kept option.
      render(
        <CertificationForm
          action={validatingAction()}
          submitLabel="Save changes"
          cancelHref="/study-tracks/demo-cloud-practitioner"
          certification={certificationFixture({ personaId: "persona-9" })}
        />,
      );

      expect(screen.getByLabelText("Persona")).toHaveValue("persona-9");
      expect(
        screen.getByRole("option", { name: "Current assignment (kept)" }),
      ).toBeVisible();
    });
  });

  it("offers a cancel link that leaves the form", () => {
    renderCreateForm();

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
