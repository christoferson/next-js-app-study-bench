import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  objectiveInputSchema,
  parseInput,
} from "@/modules/certifications/application/schemas";
import { isDomainError } from "@/modules/certifications/domain/errors";
import { objectiveFixture } from "@/modules/certifications/infrastructure/test-support";
import { ObjectiveForm } from "./objective-form";
import type { FormState } from "./form-state";
import { toInvalidFormState } from "./form-state";

function validatingAction(
  onValid: (values: Record<string, string>) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    const submitted = Object.fromEntries(
      [...form.entries()].map(([key, value]) => [key, String(value)]),
    );

    try {
      parseInput(objectiveInputSchema, submitted);
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

const CANDIDATES = [
  objectiveFixture({ id: "root", code: "Domain 1", title: "Root objective" }),
  objectiveFixture({
    id: "archived-root",
    code: null,
    title: "Archived objective",
    status: "ARCHIVED",
  }),
];

function renderObjectiveForm(options: {
  readonly action?: ReturnType<typeof validatingAction>;
  readonly parentObjectiveId?: string | null;
  readonly objective?: ReturnType<typeof objectiveFixture>;
}): void {
  render(
    <ObjectiveForm
      action={options.action ?? validatingAction()}
      submitLabel="Add objective"
      cancelHref="/study-tracks/demo"
      slug="demo"
      certificationId="certification-1"
      parentCandidates={CANDIDATES}
      parentObjectiveId={options.parentObjectiveId ?? null}
      {...(options.objective === undefined
        ? {}
        : { objective: options.objective })}
    />,
  );
}

describe("ObjectiveForm", () => {
  it("labels every field", () => {
    renderObjectiveForm({});

    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Parent objective")).toBeInTheDocument();
    expect(screen.getByLabelText("Weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Source")).toBeInTheDocument();
  });

  it("offers a top-level option plus the supplied parent candidates", () => {
    renderObjectiveForm({});

    const parentSelect = screen.getByLabelText("Parent objective");

    expect(parentSelect).toHaveTextContent("No parent — top level");
    expect(parentSelect).toHaveTextContent("Domain 1 — Root objective");
    expect(parentSelect).toHaveTextContent("Archived objective (archived)");
  });

  it("preselects the parent passed in from the tree", () => {
    renderObjectiveForm({ parentObjectiveId: "root" });

    expect(screen.getByLabelText("Parent objective")).toHaveValue("root");
  });

  it("offers only manually settable source types", () => {
    renderObjectiveForm({});

    const sourceSelect = screen.getByLabelText("Source");

    expect(sourceSelect).toHaveTextContent("User defined");
    expect(sourceSelect).toHaveTextContent("Official");
    expect(sourceSelect).not.toHaveTextContent("AI proposed");
    expect(sourceSelect).not.toHaveTextContent("Imported");
  });

  it("shows a validation message for a missing title", async () => {
    const user = userEvent.setup();
    renderObjectiveForm({});

    await user.click(screen.getByRole("button", { name: "Add objective" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Title is required.");
    });
    expect(screen.getByLabelText(/^Title/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("shows a validation message for an out-of-range weight", async () => {
    const user = userEvent.setup();
    renderObjectiveForm({});

    await user.type(screen.getByLabelText(/^Title/), "Demo objective");
    await user.type(screen.getByLabelText("Weight"), "150");
    await user.click(screen.getByRole("button", { name: "Add objective" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /weight between 0 and 100/i,
      );
    });
  });

  it("submits the track and parent identifiers alongside the fields", async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    renderObjectiveForm({
      action: validatingAction(onValid),
      parentObjectiveId: "root",
    });

    await user.type(screen.getByLabelText(/^Title/), "Child objective");
    await user.click(screen.getByRole("button", { name: "Add objective" }));

    await waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(1);
    });
    expect(onValid.mock.calls[0]?.[0]).toMatchObject({
      slug: "demo",
      certificationId: "certification-1",
      parentObjectiveId: "root",
      title: "Child objective",
      sourceType: "USER_DEFINED",
    });
  });

  it("pre-fills the form when editing an existing objective", () => {
    renderObjectiveForm({
      objective: objectiveFixture({
        id: "editing",
        title: "Existing objective",
        code: "Domain 4",
        weight: 20,
        parentObjectiveId: "root",
        sourceType: "OFFICIAL",
      }),
    });

    expect(screen.getByLabelText(/^Title/)).toHaveValue("Existing objective");
    expect(screen.getByLabelText("Code")).toHaveValue("Domain 4");
    expect(screen.getByLabelText("Weight")).toHaveValue(20);
    expect(screen.getByLabelText("Parent objective")).toHaveValue("root");
    expect(screen.getByLabelText("Source")).toHaveValue("OFFICIAL");
  });
});
