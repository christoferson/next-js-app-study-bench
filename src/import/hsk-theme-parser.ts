/**
 * Where the HSK theme-notes parser used to live.
 *
 * Moved to `@/modules/ai-generation/application/hsk-import/theme-parser`; see
 * `hsk-exam-structure-parser.ts` in this directory for why. Kept as a re-export so the
 * one-off import script and its tests keep working unchanged.
 */
export {
  HSK5_THEME_EXPECTATIONS,
  HskThemeParseError,
  assertHskThemeOutlineSize,
  parseHskThemeOutline,
  toThemeLines,
} from "@/modules/ai-generation/application/hsk-import/theme-parser";
export type {
  HskThemeEntry,
  HskThemeExpectations,
  HskThemeList,
  HskThemeOutline,
} from "@/modules/ai-generation/application/hsk-import/theme-parser";
