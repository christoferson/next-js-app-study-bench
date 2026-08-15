import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonaArchetypeMismatchError } from "@/modules/ai-generation/domain/errors";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import type { FormState } from "@/shared/ui/form-state";

/**
 * The persona-validating edge in front of the track save.
 *
 * Worth its own test because of where it sits rather than what it computes. The
 * certifications module must not know the ai-generation module exists, so a track's
 * `persona_id` is opaque text there and the check that it names a real, suitable persona
 * happens here — in the composition layer. What this file pins is the wiring: the
 * submitted choice reaches `PersonaFacade`, the resolved identifier reaches the
 * certifications action, and a refusal stops the save instead of reaching the database as
 * a foreign-key error.
 *
 * Both collaborators are doubles, deliberately. Their own behaviour is covered by
 * `persona-facade.test.ts` and the certification facade's tests; duplicating it here would
 * assert the same thing twice and say nothing about the seam.
 */

const resolveAssignment =
  vi.fn<
    (personaId: string | null, studyType: string) => Promise<string | null>
  >();
const createCertificationAction =
  vi.fn<(state: FormState, form: FormData) => Promise<FormState>>();
const updateCertificationAction =
  vi.fn<(state: FormState, form: FormData) => Promise<FormState>>();

vi.mock("@/modules/ai-generation/composition", () => ({
  getPersonaFacade: () => ({ resolveAssignment }),
}));

vi.mock("@/modules/certifications/ui/actions", () => ({
  createCertificationAction: (state: FormState, form: FormData) =>
    createCertificationAction(state, form),
  updateCertificationAction: (state: FormState, form: FormData) =>
    updateCertificationAction(state, form),
}));

const { createStudyTrackAction, updateStudyTrackAction } =
  await import("./track-actions");

function trackForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values: Record<string, string> = {
    name: "Demo Track",
    provider: "Demo Provider",
    examCode: "",
    version: "",
    studyType: "TECHNICAL_CERTIFICATION",
    description: "",
    targetDate: "",
    priority: "3",
    defaultSessionMinutes: "20",
    personaId: "",
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    form.set(key, value);
  }

  return form;
}

/** The form the delegate was handed, so the test can read what it would save. */
function delegatedForm(delegate: typeof createCertificationAction): FormData {
  const form = delegate.mock.calls[0]?.[1];

  if (form === undefined) {
    throw new Error("Expected the certifications action to have been called.");
  }

  return form;
}

describe("track actions", () => {
  beforeEach(() => {
    resolveAssignment.mockReset();
    createCertificationAction.mockReset();
    updateCertificationAction.mockReset();
    resolveAssignment.mockResolvedValue(null);
    createCertificationAction.mockResolvedValue(IDLE_FORM_STATE);
    updateCertificationAction.mockResolvedValue(IDLE_FORM_STATE);
  });

  it("validates the persona against the submitted study type", async () => {
    await createStudyTrackAction(
      IDLE_FORM_STATE,
      trackForm({
        studyType: "LANGUAGE_PROFICIENCY",
        personaId: "persona-1",
      }),
    );

    expect(resolveAssignment).toHaveBeenCalledWith(
      "persona-1",
      "LANGUAGE_PROFICIENCY",
    );
  });

  it("passes the resolved identifier on to the certifications action", async () => {
    resolveAssignment.mockResolvedValue("persona-1");

    await createStudyTrackAction(
      IDLE_FORM_STATE,
      trackForm({ personaId: "persona-1" }),
    );

    expect(delegatedForm(createCertificationAction).get("personaId")).toBe(
      "persona-1",
    );
  });

  it("treats a blank choice as automatic without asking about an identifier", async () => {
    await createStudyTrackAction(IDLE_FORM_STATE, trackForm());

    expect(resolveAssignment).toHaveBeenCalledWith(
      null,
      "TECHNICAL_CERTIFICATION",
    );
    expect(delegatedForm(createCertificationAction).get("personaId")).toBe("");
  });

  it("refuses the save and reports the mismatch on the persona field", async () => {
    resolveAssignment.mockRejectedValue(
      new PersonaArchetypeMismatchError(
        "persona-1",
        "That is a language persona.",
      ),
    );

    const state = await createStudyTrackAction(
      IDLE_FORM_STATE,
      trackForm({ personaId: "persona-1" }),
    );

    expect(state.status).toBe("invalid");
    expect(state.fieldErrors.personaId).toEqual([
      "That is a language persona.",
    ]);
    // Nothing was saved: the refusal happens before the certifications action runs.
    expect(createCertificationAction).not.toHaveBeenCalled();
  });

  it("keeps what the owner typed on a refused submission", async () => {
    resolveAssignment.mockRejectedValue(
      new PersonaArchetypeMismatchError("persona-1", "No."),
    );

    const state = await createStudyTrackAction(
      IDLE_FORM_STATE,
      trackForm({ name: "Kept Name", personaId: "persona-1" }),
    );

    expect(state.values.name).toBe("Kept Name");
  });

  it("skips the persona check when the study type is not usable", async () => {
    // The delegate is about to reject the study type itself, and there is nothing to
    // check a persona against without one.
    await createStudyTrackAction(
      IDLE_FORM_STATE,
      trackForm({ studyType: "NOT_A_STUDY_TYPE", personaId: "persona-1" }),
    );

    expect(resolveAssignment).not.toHaveBeenCalled();
    expect(createCertificationAction).toHaveBeenCalledTimes(1);
  });

  it("applies the same validation to an edit", async () => {
    resolveAssignment.mockResolvedValue("persona-2");

    await updateStudyTrackAction(
      IDLE_FORM_STATE,
      trackForm({ personaId: "persona-2" }),
    );

    expect(resolveAssignment).toHaveBeenCalledWith(
      "persona-2",
      "TECHNICAL_CERTIFICATION",
    );
    expect(delegatedForm(updateCertificationAction).get("personaId")).toBe(
      "persona-2",
    );
  });

  it("refuses an edit that names an unsuitable persona", async () => {
    resolveAssignment.mockRejectedValue(
      new PersonaArchetypeMismatchError("persona-1", "No."),
    );

    const state = await updateStudyTrackAction(
      IDLE_FORM_STATE,
      trackForm({ personaId: "persona-1" }),
    );

    expect(state.status).toBe("invalid");
    expect(updateCertificationAction).not.toHaveBeenCalled();
  });
});
