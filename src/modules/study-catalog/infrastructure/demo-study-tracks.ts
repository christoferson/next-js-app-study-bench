import type { StudyTrackDetail } from "@/modules/study-catalog/domain/study-track";

/**
 * Deterministic demo catalog content.
 *
 * Every entry is illustrative demo data written for this repository. None of it
 * is taken from an official examination, and no objective weightings or scores
 * are claimed. Objective wording describes study focus only.
 */
export const DEMO_STUDY_TRACKS: readonly StudyTrackDetail[] = [
  {
    id: "demo-track-aip-c01",
    slug: "aws-certified-generative-ai-developer-professional",
    name: "AWS Certified Generative AI Developer - Professional (AIP-C01)",
    provider: "AWS",
    studyType: "CERTIFICATION",
    origin: "DEMO",
    shortDescription:
      "Pilot track for building a personal question bank about generative AI application development on AWS.",
    objectives: [
      {
        id: "demo-objective-aip-c01-1",
        reference: "Demo domain 1",
        title: "Foundation model selection",
        focus:
          "Comparing model families, context limits, and cost characteristics for a given task.",
      },
      {
        id: "demo-objective-aip-c01-2",
        reference: "Demo domain 2",
        title: "Prompt and inference design",
        focus:
          "Structuring prompts, controlling inference parameters, and validating model output.",
      },
      {
        id: "demo-objective-aip-c01-3",
        reference: "Demo domain 3",
        title: "Retrieval-augmented applications",
        focus:
          "Chunking, embedding, and grounding responses in an application-owned source library.",
      },
      {
        id: "demo-objective-aip-c01-4",
        reference: "Demo domain 4",
        title: "Operations and safeguards",
        focus:
          "Observability, evaluation, cost control, and responsible-use guardrails for deployed features.",
      },
    ],
  },
  {
    id: "demo-track-hsk-demo",
    slug: "hsk-chinese-demo-track",
    name: "HSK Chinese — Demo Track",
    provider: "HSK",
    studyType: "LANGUAGE_EXAMINATION",
    origin: "DEMO",
    shortDescription:
      "Architecture-validation track that exercises vocabulary, listening, and character study alongside the certification format.",
    objectives: [
      {
        id: "demo-objective-hsk-1",
        reference: "Demo unit 1",
        title: "Everyday vocabulary",
        focus:
          "Recognising and recalling high-frequency words used in short daily exchanges.",
      },
      {
        id: "demo-objective-hsk-2",
        reference: "Demo unit 2",
        title: "Characters and tones",
        focus:
          "Reading common characters and distinguishing tone pairs that sound similar.",
      },
      {
        id: "demo-objective-hsk-3",
        reference: "Demo unit 3",
        title: "Short listening passages",
        focus:
          "Answering comprehension questions about brief spoken dialogues.",
      },
    ],
  },
];
