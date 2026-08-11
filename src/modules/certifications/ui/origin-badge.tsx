import type { ContentOrigin } from "@/modules/certifications/domain/certification";

interface OriginBadgeProps {
  readonly origin: ContentOrigin;
}

/**
 * Marks seeded demo content.
 *
 * Owner-authored tracks carry no badge: labelling everything would make the demo
 * label meaningless. The status is carried by visible text, not colour alone.
 */
export function OriginBadge({ origin }: OriginBadgeProps) {
  if (origin === "OWNER") {
    return null;
  }

  return <span className="badge">Demo</span>;
}
