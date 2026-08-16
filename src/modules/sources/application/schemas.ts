import { z } from "zod";
import { enumOf, requiredText } from "@/shared/schema-fields";
import { SOURCE_AUTHORITIES } from "@/modules/sources/domain/source";

/**
 * Validation for the source library's form input.
 *
 * Built on `@/shared/schema-fields`, so the trimming, the empty-to-null rule, and the
 * closed-union handling behave the way every other form in the application does
 * (`spec/CODING-STANDARDS.md` section 2).
 */

/** How long a source title may be. Long enough for a real document name. */
export const MAX_SOURCE_TITLE_CHARS = 200;

/**
 * How much text may be pasted, and how large an uploaded file may be.
 *
 * A million characters is a few hundred pages — more than any exam guide — and the file
 * cap is the same order of magnitude in bytes. Both exist to bound one request's memory,
 * not to express a policy about document length.
 */
export const MAX_PASTED_CHARS = 1_000_000;
export const MAX_SOURCE_FILE_BYTES = 12 * 1024 * 1024;

/** How long a URL may be, which is generous next to what browsers accept. */
export const MAX_SOURCE_URL_CHARS = 2000;

const authority = enumOf(
  [...SOURCE_AUTHORITIES],
  "Choose how authoritative this source is.",
);

export const importPastedSourceSchema = z.object({
  title: requiredText("A title", MAX_SOURCE_TITLE_CHARS),
  authority,
  text: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      message: "Paste the text you want to import.",
    })
    .refine((value) => value.length <= MAX_PASTED_CHARS, {
      message: `Paste ${MAX_PASTED_CHARS.toLocaleString("en-GB")} characters or fewer.`,
    }),
  /** Markdown and plain text differ only in what the owner says they are. */
  isMarkdown: z
    .string()
    .optional()
    .transform((value) => value === "on" || value === "true"),
});

export const importFileSourceSchema = z.object({
  /** Optional: an empty title takes the filename, which is usually what it should be. */
  title: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= MAX_SOURCE_TITLE_CHARS, {
      message: `Use ${MAX_SOURCE_TITLE_CHARS} characters or fewer.`,
    }),
  authority,
});

export const importUrlSourceSchema = z.object({
  title: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= MAX_SOURCE_TITLE_CHARS, {
      message: `Use ${MAX_SOURCE_TITLE_CHARS} characters or fewer.`,
    }),
  authority,
  /**
   * Shape only. Whether the address may actually be *fetched* is decided by
   * `checkUrlIsSafeToFetch` against resolved DNS, which a schema cannot do — so this
   * field deliberately does not try, and rejecting `http://localhost` here would only
   * teach a reader that the schema is where that rule lives.
   */
  url: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      message: "Enter the address of the page to import.",
    })
    .refine((value) => value.length <= MAX_SOURCE_URL_CHARS, {
      message: "That address is too long.",
    }),
});

export const sourceIdentitySchema = z.object({
  sourceId: requiredText("A source", 100),
});

export const linkSourceObjectiveSchema = z.object({
  sourceId: requiredText("A source", 100),
  objectiveId: requiredText("An objective", 100),
});

export const editSourceSchema = z.object({
  sourceId: requiredText("A source", 100),
  title: requiredText("A title", MAX_SOURCE_TITLE_CHARS),
  authority,
});
