import { describe, expect, it } from "vitest";
import {
  MAX_PERSONA_FILE_BYTES,
  toPersonaEnvelope,
} from "@/modules/ai-generation/domain/persona-export";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import { importPersonaAction } from "./persona-import-actions";
import { IDLE_PERSONA_IMPORT_STATE } from "./persona-import-state";

/**
 * The import action, over real uploaded bytes.
 *
 * This is where the file path is exercised: a component test cannot carry a file's bytes
 * through a rendered form under jsdom, so the cases that depend on actually reading an
 * upload live here. The action calls no facade and writes nothing — a successful import
 * returns a draft — which is the property the first case pins.
 */
const ENVELOPE = toPersonaEnvelope(storedPersonaFixture());

function upload(contents: string, name = "persona.json"): FormData {
  const form = new FormData();

  form.set(
    "personaFile",
    new File([contents], name, { type: "application/json" }),
  );

  return form;
}

function run(form: FormData) {
  return importPersonaAction(IDLE_PERSONA_IMPORT_STATE, form);
}

describe("importPersonaAction", () => {
  it("reads an uploaded file into a draft without writing anything", async () => {
    // No facade is injected and none is reachable: an import produces a draft, and the
    // owner's submission of the create form is what writes.
    const state = await run(upload(JSON.stringify(ENVELOPE)));

    expect(state.status).toBe("idle");
    expect(state.imported?.archetype).toBe("TECHNICAL");
    expect(state.imported?.draft.label).toBe("AWS associate level");
    expect(state.imported?.draft.guidance).toEqual(
      storedPersonaFixture().guidance,
    );
  });

  it("prefers the file when a leftover paste is also present", async () => {
    const form = upload(JSON.stringify(ENVELOPE));

    form.set(
      "pastedJson",
      JSON.stringify({ ...ENVELOPE, label: "From the paste box" }),
    );

    const state = await run(form);

    expect(state.imported?.draft.label).toBe("AWS associate level");
  });

  it("falls back to the paste box when the file entry is empty", async () => {
    const form = new FormData();

    form.set("personaFile", new File([], "", { type: "application/json" }));
    form.set("pastedJson", JSON.stringify(ENVELOPE));

    const state = await run(form);

    expect(state.imported?.draft.label).toBe("AWS associate level");
  });

  it("reports an unreadable upload on the file field", async () => {
    const state = await run(upload("<html>not a persona</html>"));

    expect(state.imported).toBeNull();
    expect(state.status).toBe("invalid");
    expect(state.fieldErrors.personaFile?.[0]).toContain("not readable JSON");
  });

  it("refuses an oversized file without reading it", async () => {
    // The declared size decides, so a large upload is never buffered to find out it is
    // not a persona.
    const state = await run(upload("x".repeat(MAX_PERSONA_FILE_BYTES + 1)));

    expect(state.fieldErrors.personaFile?.[0]).toContain("larger than");
  });

  it("refuses an oversized paste", async () => {
    const form = new FormData();

    form.set("pastedJson", "x".repeat(MAX_PERSONA_FILE_BYTES + 1));

    const state = await run(form);

    expect(state.fieldErrors.pastedJson?.[0]).toContain("longer than");
  });

  it("asks for an input when the form carries neither", async () => {
    const state = await run(new FormData());

    expect(state.fieldErrors.personaFile?.[0]).toContain(
      "Choose a persona file",
    );
  });

  it("reports a content failure on the key inside the file", async () => {
    const state = await run(upload(JSON.stringify({ ...ENVELOPE, role: "" })));

    expect(state.imported).toBeNull();
    expect(state.fieldErrors.role?.[0]).toContain("required");
  });
});
