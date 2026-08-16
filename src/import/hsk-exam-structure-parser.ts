/**
 * Where the HSK examination-structure parser used to live.
 *
 * The parser moved to `@/modules/ai-generation/application/hsk-import/exam-structure-parser`
 * when the web import gained strategies: the upload flow needs it, and `ai-generation` must
 * not import from `src/import`, which is script-side code that opens databases and reads the
 * filesystem. The parser itself is a pure function over a string, so the move cost nothing.
 *
 * This file stays as a re-export so `scripts/import-hsk-syllabus.ts` and the importer's own
 * tests keep working unchanged. New code should import from the new path.
 */
export {
  HSK5_STRUCTURE_EXPECTATIONS,
  HSK_EXAM_SKILL_KINDS,
  HskExamStructureParseError,
  assertHskExamStructureSize,
  parseHskExamStructure,
  toStructureLines,
} from "@/modules/ai-generation/application/hsk-import/exam-structure-parser";
export type {
  HskExamPart,
  HskExamSkill,
  HskExamSkillKind,
  HskExamStructure,
  HskExamStructureExpectations,
} from "@/modules/ai-generation/application/hsk-import/exam-structure-parser";
