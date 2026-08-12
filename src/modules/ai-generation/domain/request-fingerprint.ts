import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { GeneratedItemKind } from "./generation-run";
import type { GenerationRequestSpec } from "./generated-draft";

/**
 * Canonical text of a generation request (`SPEC.md` section 11.6, "avoiding
 * repeated generation when an equivalent batch already exists").
 *
 * Pure and framework-free: it turns a request into one stable string, and the
 * application hashes that string. Splitting it this way keeps the rule about *what
 * makes two requests equivalent* in the domain, where it can be tested without a
 * hash function, and leaves the hashing to the platform.
 *
 * Equivalence is deliberately about the *request*, not the wording of it:
 *
 * - Objectives are sorted, because choosing domains 1 and 2 is the same request as
 *   choosing 2 and 1.
 * - Types are sorted for the same reason.
 * - Owner text is trimmed and whitespace-collapsed but otherwise kept verbatim,
 *   because "focus on VPC peering" and "focus on IAM" are genuinely different
 *   requests and must not collide.
 * - Case is preserved in owner text: a model reads case, so changing it changes
 *   the request.
 * - The item count is included, because asking for ten of something after asking
 *   for three is not a repeat.
 *
 * The persona and template are not part of the fingerprint. They are recorded on
 * the run as provenance, but they are derived from the track rather than chosen by
 * the owner, so including them would make a persona version bump silently reset
 * every duplicate warning.
 */
export function canonicalRequestText(request: {
  readonly certificationId: CertificationId;
  readonly itemKind: GeneratedItemKind;
  readonly spec: GenerationRequestSpec;
}): string {
  const { spec } = request;

  return [
    `track=${request.certificationId}`,
    `kind=${request.itemKind}`,
    `count=${spec.itemCount}`,
    `difficulty=${spec.difficulty === null ? "any" : spec.difficulty}`,
    `objectives=${[...spec.objectiveIds].sort().join(",")}`,
    `questionTypes=${[...spec.questionTypes].sort().join(",")}`,
    `cardTypes=${[...spec.cardTypes].sort().join(",")}`,
    `notes=${normalizeNotes(spec.additionalInstructions)}`,
  ].join("\n");
}

/**
 * Owner text reduced to what changes the request.
 *
 * Trailing spaces and a wrapped line are not a different request; different words
 * are.
 */
function normalizeNotes(notes: string | null): string {
  return (notes ?? "").replace(/\s+/g, " ").trim();
}
