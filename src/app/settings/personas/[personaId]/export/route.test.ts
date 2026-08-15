import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import { PERSONA_ENVELOPE_KEY } from "@/modules/ai-generation/domain/persona-export";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";

/**
 * The persona download route.
 *
 * What matters here is the contract a browser's download depends on — a JSON content
 * type, an attachment filename taken from the row rather than the request, and a body that
 * imports back — plus a 404 that says nothing about what exists. The format itself is
 * asserted in `persona-envelope-schema.test.ts`; this file asserts that the response
 * carries it.
 */

const findPersona = vi.fn<(id: string) => Promise<StoredPersona | null>>();

vi.mock("@/modules/ai-generation/composition", () => ({
  getPersonaFacade: () => ({ findPersona }),
}));

const { GET } =
  await import("@/app/settings/personas/[personaId]/export/route");

function request(personaId: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/settings/personas/${personaId}/export`),
    { params: Promise.resolve({ personaId }) },
  );
}

describe("GET /settings/personas/[personaId]/export", () => {
  beforeEach(() => {
    findPersona.mockReset();
  });

  describe("for a known persona", () => {
    beforeEach(() => {
      findPersona.mockResolvedValue(storedPersonaFixture());
    });

    it("serves the envelope as JSON", async () => {
      const response = await request("persona-1");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain(
        "application/json",
      );
    });

    it("offers it as a download named after the persona key", async () => {
      const response = await request("persona-1");

      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="aws-associate-level.persona.json"',
      );
    });

    it("names the file from the row, never from the request", async () => {
      // The identifier is a lookup key. Nothing from the URL reaches the header, which is
      // what keeps `Content-Disposition` from being an injection point.
      findPersona.mockResolvedValue(
        storedPersonaFixture({ personaKey: "hsk-chinese" }),
      );

      const response = await request('evil"; filename="x');

      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="hsk-chinese.persona.json"',
      );
    });

    it("writes the version marker and the persona's wording", async () => {
      const persona = storedPersonaFixture();
      const body = (await request("persona-1").then((response) =>
        response.json(),
      )) as Record<string, unknown>;

      expect(body[PERSONA_ENVELOPE_KEY]).toBe(1);
      expect(body.label).toBe(persona.label);
      expect(body.archetype).toBe("TECHNICAL");
      expect(body.guidance).toEqual(persona.guidance);
    });

    it.each(["id", "personaKey", "version", "createdAt", "updatedAt"])(
      "leaves %s out of the body",
      async (field) => {
        const body = (await request("persona-1").then((response) =>
          response.json(),
        )) as Record<string, unknown>;

        expect(body).not.toHaveProperty(field);
      },
    );

    it("is not cached, so a download after an edit is the new version", async () => {
      const response = await request("persona-1");

      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("looks the persona up by identifier", async () => {
      await request("persona-1");

      expect(findPersona).toHaveBeenCalledWith("persona-1");
    });
  });

  describe("for a persona it cannot serve", () => {
    beforeEach(() => {
      findPersona.mockResolvedValue(null);
    });

    it("returns 404 with an empty body", async () => {
      const response = await request("nope");

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("");
    });

    it("says nothing about what does exist", async () => {
      const response = await request("nope");

      expect(await response.text()).not.toContain("nope");
      expect(response.headers.get("Content-Disposition")).toBeNull();
    });

    it.each(["../../../etc/passwd", "data/study-bench.db"])(
      "treats %j as an unknown identifier, not a path",
      async (personaId) => {
        const response = await request(personaId);

        expect(response.status).toBe(404);
        expect(findPersona).toHaveBeenCalledWith(personaId);
      },
    );
  });
});
