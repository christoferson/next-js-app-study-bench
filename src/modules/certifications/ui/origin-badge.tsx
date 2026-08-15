import type { ContentOrigin } from "@/modules/certifications/domain/certification";

interface OriginBadgeProps {
  readonly origin: ContentOrigin;
}

/**
 * Marks seeded demo content.
 *
 * Owner-authored tracks carry no badge: labelling everything would make the demo
 * label meaningless. The status is carried by visible text, not colour alone.
 *
 * Gold fill, because this is the one badge that says "this is not yours" — it is what tells
 * the owner which tracks they can delete without losing work. The word carries the meaning;
 * the fill only makes it findable while scanning a list.
 */
export function OriginBadge({ origin }: OriginBadgeProps) {
  if (origin === "OWNER") {
    return null;
  }

  return <span className="badge badge-highlight">Demo</span>;
}
