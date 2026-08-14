import Link from "next/link";
import type { Certification } from "@/modules/certifications/domain/certification";
import { CertificationMeta } from "./certification-meta";
import { OriginBadge } from "./origin-badge";
import {
  deleteCertificationAction,
  restoreCertificationAction,
} from "./actions";

interface CertificationCardProps {
  readonly certification: Certification;
}

/** Dashboard list entry for one active study track. */
export function CertificationCard({ certification }: CertificationCardProps) {
  return (
    <li className="card">
      <div className="card-heading">
        <h3 className="card-title">
          <Link href={`/study-tracks/${certification.slug}`}>
            {certification.name}
          </Link>
        </h3>
        <OriginBadge origin={certification.origin} />
      </div>
      <CertificationMeta certification={certification} />
      {certification.description.length > 0 ? (
        <p className="card-text">{certification.description}</p>
      ) : null}
    </li>
  );
}

/**
 * Dashboard list entry for an archived study track.
 *
 * Archived tracks are labelled and offer restore, or permanent deletion. They
 * are not linked to their detail page from here; restoring first keeps the
 * archived state unambiguous. Deletion is unconditional (owner decision,
 * 2026-08-14): archiving first is the confirmation step, and the button says
 * plainly that everything goes.
 */
export function ArchivedCertificationCard({
  certification,
}: CertificationCardProps) {
  return (
    <li className="card card-archived">
      <div className="card-heading">
        <h3 className="card-title">{certification.name}</h3>
        <span className="badge">Archived</span>
        <OriginBadge origin={certification.origin} />
      </div>
      <CertificationMeta certification={certification} />
      <div className="section-actions">
        <form action={restoreCertificationAction} className="inline-form">
          <input
            type="hidden"
            name="certificationId"
            value={certification.id}
            readOnly
          />
          <button
            type="submit"
            className="button-quiet"
            aria-label={`Restore ${certification.name}`}
          >
            Restore
          </button>
        </form>
        <form action={deleteCertificationAction} className="inline-form">
          <input
            type="hidden"
            name="certificationId"
            value={certification.id}
            readOnly
          />
          <button
            type="submit"
            className="button-danger"
            aria-label={`Delete ${certification.name} and all of its study data permanently`}
          >
            Delete permanently
          </button>
        </form>
      </div>
    </li>
  );
}
