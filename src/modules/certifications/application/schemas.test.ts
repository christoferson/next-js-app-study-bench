import { describe, expect, it } from "vitest";
import { ValidationError } from "@/modules/certifications/domain/errors";
import {
  certificationInputSchema,
  moveDirectionSchema,
  objectiveInputSchema,
  parseInput,
} from "./schemas";

const VALID_CERTIFICATION = {
  name: "Demo Cloud Practitioner",
  provider: "Demo Provider",
  examCode: "DEMO-001",
  version: "",
  studyType: "TECHNICAL_CERTIFICATION",
  description: "  A fictional track.  ",
  targetDate: "2026-09-30",
  priority: "2",
  defaultSessionMinutes: "30",
};

const VALID_OBJECTIVE = {
  parentObjectiveId: "",
  code: "Demo domain 1",
  title: "Model selection",
  description: "",
  weight: "25.5",
  sourceType: "USER_DEFINED",
};

function fieldsOf(input: unknown, schema: Parameters<typeof parseInput>[0]) {
  try {
    parseInput(schema, input);
    expect.unreachable("expected a validation error");
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);

    return Object.keys((error as ValidationError).fieldMessages());
  }

  return [];
}

describe("certificationInputSchema", () => {
  it("accepts and normalises a valid submission", () => {
    const parsed = parseInput(certificationInputSchema, VALID_CERTIFICATION);

    expect(parsed).toEqual({
      name: "Demo Cloud Practitioner",
      provider: "Demo Provider",
      examCode: "DEMO-001",
      version: null,
      studyType: "TECHNICAL_CERTIFICATION",
      description: "A fictional track.",
      targetDate: "2026-09-30",
      priority: 2,
      defaultSessionMinutes: 30,
    });
  });

  it("rejects a blank name against the name field", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, name: "   " },
        certificationInputSchema,
      ),
    ).toEqual(["name"]);
  });

  it("rejects a blank provider against the provider field", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, provider: "" },
        certificationInputSchema,
      ),
    ).toEqual(["provider"]);
  });

  it("rejects an unknown study type", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, studyType: "CERTIFICATION" },
        certificationInputSchema,
      ),
    ).toEqual(["studyType"]);
  });

  it("rejects a malformed target date", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, targetDate: "30/09/2026" },
        certificationInputSchema,
      ),
    ).toEqual(["targetDate"]);
  });

  it("rejects a date that does not exist", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, targetDate: "2026-02-30" },
        certificationInputSchema,
      ),
    ).toEqual(["targetDate"]);
  });

  it("treats a blank target date as not provided", () => {
    const parsed = parseInput(certificationInputSchema, {
      ...VALID_CERTIFICATION,
      targetDate: "",
    });

    expect(parsed.targetDate).toBeNull();
  });

  it("rejects a priority outside the supported range", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, priority: "6" },
        certificationInputSchema,
      ),
    ).toEqual(["priority"]);
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, priority: "0" },
        certificationInputSchema,
      ),
    ).toEqual(["priority"]);
  });

  it("rejects a non-integer session length", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, defaultSessionMinutes: "22.5" },
        certificationInputSchema,
      ),
    ).toEqual(["defaultSessionMinutes"]);
  });

  it("rejects a session length outside the supported range", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, defaultSessionMinutes: "1" },
        certificationInputSchema,
      ),
    ).toEqual(["defaultSessionMinutes"]);
  });

  it("reports every invalid field at once", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, name: "", provider: "", priority: "9" },
        certificationInputSchema,
      ).sort(),
    ).toEqual(["name", "priority", "provider"]);
  });

  it("rejects an over-long name", () => {
    expect(
      fieldsOf(
        { ...VALID_CERTIFICATION, name: "a".repeat(201) },
        certificationInputSchema,
      ),
    ).toEqual(["name"]);
  });
});

describe("objectiveInputSchema", () => {
  it("accepts and normalises a valid submission", () => {
    expect(parseInput(objectiveInputSchema, VALID_OBJECTIVE)).toEqual({
      parentObjectiveId: null,
      code: "Demo domain 1",
      title: "Model selection",
      description: null,
      weight: 25.5,
      sourceType: "USER_DEFINED",
    });
  });

  it("keeps a supplied parent identifier", () => {
    const parsed = parseInput(objectiveInputSchema, {
      ...VALID_OBJECTIVE,
      parentObjectiveId: "objective-7",
    });

    expect(parsed.parentObjectiveId).toBe("objective-7");
  });

  it("rejects a blank title against the title field", () => {
    expect(
      fieldsOf({ ...VALID_OBJECTIVE, title: " " }, objectiveInputSchema),
    ).toEqual(["title"]);
  });

  it("treats a blank weight as not provided", () => {
    const parsed = parseInput(objectiveInputSchema, {
      ...VALID_OBJECTIVE,
      weight: "",
    });

    expect(parsed.weight).toBeNull();
  });

  it("rejects a weight outside 0 to 100", () => {
    expect(
      fieldsOf({ ...VALID_OBJECTIVE, weight: "101" }, objectiveInputSchema),
    ).toEqual(["weight"]);
    expect(
      fieldsOf({ ...VALID_OBJECTIVE, weight: "-1" }, objectiveInputSchema),
    ).toEqual(["weight"]);
  });

  it("rejects a non-numeric weight", () => {
    expect(
      fieldsOf({ ...VALID_OBJECTIVE, weight: "heavy" }, objectiveInputSchema),
    ).toEqual(["weight"]);
  });

  it("rejects a source type the owner may not set manually", () => {
    expect(
      fieldsOf(
        { ...VALID_OBJECTIVE, sourceType: "AI_PROPOSED" },
        objectiveInputSchema,
      ),
    ).toEqual(["sourceType"]);
  });

  it("accepts official source types", () => {
    for (const sourceType of ["OFFICIAL", "OFFICIAL_SYLLABUS"]) {
      expect(
        parseInput(objectiveInputSchema, { ...VALID_OBJECTIVE, sourceType })
          .sourceType,
      ).toBe(sourceType);
    }
  });
});

describe("moveDirectionSchema", () => {
  it("accepts the supported directions", () => {
    expect(parseInput(moveDirectionSchema, "UP")).toBe("UP");
    expect(parseInput(moveDirectionSchema, "DOWN")).toBe("DOWN");
  });

  it("rejects anything else", () => {
    expect(() => parseInput(moveDirectionSchema, "SIDEWAYS")).toThrow(
      ValidationError,
    );
  });
});
