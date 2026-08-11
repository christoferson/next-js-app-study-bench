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

  it("offers a cancel link that leaves the form", () => {
    renderCreateForm();

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
