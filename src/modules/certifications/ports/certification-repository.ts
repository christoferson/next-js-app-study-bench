import type { IsoTimestamp } from "@/platform/clock";
import type {
  Certification,
  CertificationId,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";

/**
 * Persistence port for certifications.
 *
 * The methods describe the access patterns the application actually needs. No
 * SQL, query builder, or database row crosses this boundary.
 */
export interface CertificationRepository {
  /** Active tracks in owner-facing order: priority, then name. */
  listActive(): Promise<Certification[]>;
  /** Archived tracks, newest archival activity first by name order. */
  listArchived(): Promise<Certification[]>;
  findById(id: CertificationId): Promise<Certification | null>;
  findBySlug(slug: CertificationSlug): Promise<Certification | null>;
  /** Slug uniqueness check used when deriving a slug from a track name. */
  isSlugTaken(slug: CertificationSlug): Promise<boolean>;
  /**
   * Tracks that have this persona identifier assigned, active or archived.
   *
   * Takes an opaque string, and this module never learns what it refers to: the
   * caller is the ai-generation module, which asks before deleting a persona so the
   * owner is told which tracks to change instead of meeting a constraint error. Both
   * lifecycles are returned, because an archived track can be restored and would then
   * point at a persona that no longer exists.
   */
  listByPersonaId(personaId: string): Promise<Certification[]>;
  /** Inserts or replaces the whole record; identity is application-generated. */
  save(certification: Certification): Promise<void>;
  archive(id: CertificationId, occurredAt: IsoTimestamp): Promise<void>;
  restore(id: CertificationId, occurredAt: IsoTimestamp): Promise<void>;
  /**
   * Removes the track and everything that ever referenced it — objectives,
   * questions and their revisions, flashcards and their revisions and reviews,
   * schedules, generation runs, and every study session that included the track
   * with its items and attempts. Unconditional by owner decision (2026-08-14):
   * "all data including all related data clean and purged of the system as if
   * they never existed." One transaction; the caller guards on archived status.
   */
  purge(id: CertificationId): Promise<void>;
}
