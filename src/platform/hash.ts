import { createHash } from "node:crypto";

/**
 * Content hashing.
 *
 * Used to fingerprint a generation request so an equivalent batch can be
 * recognised before it is generated again (`SPEC.md` section 11.6). A hash rather
 * than the canonical text itself keeps the stored value a fixed width whatever the
 * owner typed, and it is deterministic, so the same request always produces the
 * same fingerprint across processes and restarts.
 *
 * Not a security primitive: nothing here authenticates or protects anything, and
 * no secret is ever hashed.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
