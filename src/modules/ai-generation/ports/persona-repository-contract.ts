import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import type { PersonaRepository } from "./persona-repository";

/**
 * Shared persona-repository contract.
 *
 * Defines the domain-observable behaviour every persona persistence adapter must
 * provide, so the PostgreSQL adapter in D13 runs these same assertions rather than a
 * parallel set (`spec/ARCHITECTURE.md` section 7.4). It is where "a JSON column
 * round-trips as an array" and "a taken key is refused" are stated, because both are
 * promises of the port rather than of SQLite.
 */

export interface PersonaContractSubject {
  readonly personas: PersonaRepository;
  /** Called after each test so state never leaks between cases. */
  dispose(): void;
}

export function describePersonaRepositoryContract(
  adapterName: string,
  createSubject: () => PersonaContractSubject,
): void {
  describe(`${adapterName} persona repository contract`, () => {
    let subject: PersonaContractSubject;

    beforeEach(() => {
      subject = createSubject();
    });

    afterEach(() => {
      subject.dispose();
    });

    it("round-trips every field, including the JSON lists", async () => {
      const persona = storedPersonaFixture();

      await subject.personas.insert(persona);

      await expect(subject.personas.findById(persona.id)).resolves.toEqual(
        persona,
      );
    });

    it("round-trips a persona with no content language", async () => {
      // The nullable column, so it is not write-only.
      const persona = storedPersonaFixture({ contentLanguage: null });

      await subject.personas.insert(persona);

      await expect(subject.personas.findById(persona.id)).resolves.toEqual(
        persona,
      );
    });

    it("finds a persona by its stable key", async () => {
      const persona = storedPersonaFixture();

      await subject.personas.insert(persona);

      await expect(
        subject.personas.findByKey(persona.personaKey),
      ).resolves.toEqual(persona);
    });

    it("reports nothing for an identifier and a key it does not have", async () => {
      await expect(subject.personas.findById("nope")).resolves.toBeNull();
      await expect(subject.personas.findByKey("nope")).resolves.toBeNull();
    });

    it("refuses a second persona with the same key", async () => {
      // The unique key is what makes a recorded run's persona unambiguous, so a
      // duplicate must fail rather than be silently accepted.
      await subject.personas.insert(storedPersonaFixture());

      await expect(
        subject.personas.insert(
          storedPersonaFixture({ id: "persona-2", label: "Another" }),
        ),
      ).rejects.toThrow();
    });

    describe("list", () => {
      it("orders by label", async () => {
        await subject.personas.insert(
          storedPersonaFixture({
            id: "b",
            personaKey: "beta",
            label: "Beta persona",
          }),
        );
        await subject.personas.insert(
          storedPersonaFixture({
            id: "a",
            personaKey: "alpha",
            label: "Alpha persona",
          }),
        );

        const listed = await subject.personas.list();

        expect(listed.map((persona) => persona.label)).toEqual([
          "Alpha persona",
          "Beta persona",
        ]);
      });

      it("returns nothing when there is nothing", async () => {
        // A fresh installation. Nothing is seeded into this table.
        await expect(subject.personas.list()).resolves.toEqual([]);
      });
    });

    describe("update", () => {
      it("replaces the editable fields and the version", async () => {
        const persona = storedPersonaFixture();

        await subject.personas.insert(persona);

        const edited = {
          ...persona,
          version: 2,
          label: "Renamed",
          guidance: ["Only one guideline now."],
          contentLanguage: null,
          updatedAt: "2026-02-02T00:00:00.000Z",
        };

        await expect(subject.personas.update(edited)).resolves.toBe(true);
        await expect(subject.personas.findById(persona.id)).resolves.toEqual(
          edited,
        );
      });

      it("leaves the key and the creation time alone", async () => {
        // Both are fixed at creation: a renamed persona must stay traceable, and
        // rewriting `createdAt` would erase when it appeared.
        const persona = storedPersonaFixture();

        await subject.personas.insert(persona);
        await subject.personas.update({
          ...persona,
          version: 2,
          personaKey: "something-else",
          createdAt: "2030-01-01T00:00:00.000Z",
        });

        const stored = await subject.personas.findById(persona.id);

        expect(stored?.personaKey).toBe(persona.personaKey);
        expect(stored?.createdAt).toBe(persona.createdAt);
      });

      it("reports no match rather than inserting", async () => {
        await expect(
          subject.personas.update(storedPersonaFixture({ id: "ghost" })),
        ).resolves.toBe(false);
        await expect(subject.personas.list()).resolves.toEqual([]);
      });
    });

    describe("delete", () => {
      it("removes the persona and frees its key", async () => {
        const persona = storedPersonaFixture();

        await subject.personas.insert(persona);
        await subject.personas.delete(persona.id);

        await expect(subject.personas.findById(persona.id)).resolves.toBeNull();
        await expect(
          subject.personas.insert(storedPersonaFixture({ id: "persona-2" })),
        ).resolves.toBeUndefined();
      });

      it("succeeds for an identifier it does not have", async () => {
        await expect(subject.personas.delete("nope")).resolves.toBeUndefined();
      });

      it("leaves other personas alone", async () => {
        await subject.personas.insert(storedPersonaFixture({ id: "keep" }));
        await subject.personas.insert(
          storedPersonaFixture({ id: "drop", personaKey: "drop-me" }),
        );

        await subject.personas.delete("drop");

        await expect(subject.personas.findById("keep")).resolves.not.toBeNull();
      });
    });
  });
}
