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
  /** Inserts or replaces the whole record; identity is application-generated. */
  save(certification: Certification): Promise<void>;
  archive(id: CertificationId, occurredAt: IsoTimestamp): Promise<void>;
  restore(id: CertificationId, occurredAt: IsoTimestamp): Promise<void>;
}
