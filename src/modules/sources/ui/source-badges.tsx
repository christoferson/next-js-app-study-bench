import type {
  SourceAuthority,
  SourceType,
} from "@/modules/sources/domain/source";

/**
 * The two words that describe a source at a glance.
 *
 * Type and authority are shown together everywhere, because either alone is misleading:
 * "PDF" says nothing about whether it is the official exam guide, and "Official" says
 * nothing about whether it can be refreshed. Kept as one small module so the list and
 * the detail page cannot label the same source differently.
 */

const TYPE_LABELS: Readonly<Record<SourceType, string>> = {
  PASTED_TEXT: "Pasted text",
  MARKDOWN: "Markdown",
  TEXT_PDF: "PDF",
  WEB_URL: "Web page",
};

const AUTHORITY_LABELS: Readonly<Record<SourceAuthority, string>> = {
  OFFICIAL: "Official",
  TRUSTED_THIRD_PARTY: "Trusted third party",
  USER_AUTHORED: "Written by me",
  GENERAL_WEB: "General web",
  UNKNOWN: "Unknown authority",
};

export function describeSourceType(sourceType: SourceType): string {
  return TYPE_LABELS[sourceType];
}

export function describeSourceAuthority(authority: SourceAuthority): string {
  return AUTHORITY_LABELS[authority];
}

interface SourceBadgesProps {
  readonly sourceType: SourceType;
  readonly authority: SourceAuthority;
  readonly archived: boolean;
}

/**
 * Type, authority, and — only when it applies — archived.
 *
 * `OFFICIAL` is highlighted because it is the one value that changes how the owner should
 * read a generated question later, and an archived source is marked because otherwise the
 * only difference between a live and a retired source in a list is its position.
 */
export function SourceBadges({
  sourceType,
  authority,
  archived,
}: SourceBadgesProps) {
  return (
    <>
      <span className="badge">{describeSourceType(sourceType)}</span>
      <span
        className={authority === "OFFICIAL" ? "badge badge-highlight" : "badge"}
      >
        {describeSourceAuthority(authority)}
      </span>
      {archived ? <span className="badge">Archived</span> : null}
    </>
  );
}
