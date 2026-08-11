import type { Clock } from "@/platform/clock";
import type { IdGenerator } from "@/platform/id-generator";
import type { StudyType } from "@/modules/certifications/domain/certification";
import {
  DEFAULT_SESSION_MINUTES,
  slugify,
} from "@/modules/certifications/domain/certification";
import type {
  Objective,
  ObjectiveSourceType,
} from "@/modules/certifications/domain/objective";
import type { CertificationUnitOfWork } from "@/modules/certifications/ports/unit-of-work";

/**
 * Optional demo seed (`npm run seed`).
 *
 * Every record is illustrative content written for this repository. None of it
 * comes from an official examination, and no weightings or scores are claimed.
 * Seeded tracks carry `origin: "DEMO"` so the interface labels them as demo
 * content and the owner never mistakes them for their own material.
 *
 * The seed is idempotent by slug: a track whose slug already exists is skipped
 * whole, including its objectives. It never edits or deletes existing records.
 */

interface DemoObjective {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly children?: readonly DemoObjective[];
}

interface DemoTrack {
  readonly name: string;
  readonly provider: string;
  readonly examCode: string | null;
  readonly studyType: StudyType;
  readonly description: string;
  readonly priority: number;
  readonly objectives: readonly DemoObjective[];
}

const DEMO_SOURCE_TYPE: ObjectiveSourceType = "USER_DEFINED";

const DEMO_TRACKS: readonly DemoTrack[] = [
  {
    name: "AWS Certified Generative AI Developer - Professional (AIP-C01)",
    provider: "AWS",
    examCode: "AIP-C01",
    studyType: "TECHNICAL_CERTIFICATION",
    description:
      "Demo track for building a personal question bank about generative AI application development on AWS.",
    priority: 2,
    objectives: [
      {
        code: "Demo domain 1",
        title: "Foundation model selection",
        description:
          "Comparing model families, context limits, and cost characteristics for a given task.",
        children: [
          {
            code: "Demo task 1.1",
            title: "Model capability comparison",
            description:
              "Matching task requirements to model strengths before committing to one family.",
          },
          {
            code: "Demo task 1.2",
            title: "Cost and latency trade-offs",
            description:
              "Estimating token cost and response time for a candidate design.",
          },
        ],
      },
      {
        code: "Demo domain 2",
        title: "Prompt and inference design",
        description:
          "Structuring prompts, controlling inference parameters, and validating model output.",
      },
      {
        code: "Demo domain 3",
        title: "Retrieval-augmented applications",
        description:
          "Chunking, embedding, and grounding responses in an application-owned source library.",
      },
      {
        code: "Demo domain 4",
        title: "Operations and safeguards",
        description:
          "Observability, evaluation, cost control, and responsible-use guardrails for deployed features.",
      },
    ],
  },
  {
    name: "HSK Chinese — Demo Track",
    provider: "HSK",
    examCode: null,
    studyType: "LANGUAGE_PROFICIENCY",
    description:
      "Demo track that exercises vocabulary, listening, and character study alongside the certification format.",
    priority: 3,
    objectives: [
      {
        code: "Demo unit 1",
        title: "Everyday vocabulary",
        description:
          "Recognising and recalling high-frequency words used in short daily exchanges.",
        children: [
          {
            code: "Demo unit 1.1",
            title: "Greetings and introductions",
            description: "Opening and closing a short everyday conversation.",
          },
        ],
      },
      {
        code: "Demo unit 2",
        title: "Characters and tones",
        description:
          "Reading common characters and distinguishing tone pairs that sound similar.",
      },
      {
        code: "Demo unit 3",
        title: "Short listening passages",
        description:
          "Answering comprehension questions about brief spoken dialogues.",
      },
    ],
  },
];

export interface SeedOutcome {
  readonly inserted: readonly string[];
  readonly skipped: readonly string[];
}

export interface SeedDependencies {
  readonly unitOfWork: CertificationUnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Inserts the demo tracks that are not present yet.
 *
 * Each track is inserted in one transaction together with its objectives, so a
 * partially seeded track can never be observed.
 */
export async function seedDemoContent(
  deps: SeedDependencies,
): Promise<SeedOutcome> {
  const inserted: string[] = [];
  const skipped: string[] = [];

  for (const track of DEMO_TRACKS) {
    const slug = slugify(track.name);

    const wasInserted = await deps.unitOfWork.transaction(
      async ({ certifications, objectives }) => {
        if (await certifications.isSlugTaken(slug)) {
          return false;
        }

        const now = deps.clock.now();
        const certificationId = deps.ids.nextId();

        await certifications.save({
          id: certificationId,
          slug,
          name: track.name,
          provider: track.provider,
          examCode: track.examCode,
          version: null,
          studyType: track.studyType,
          description: track.description,
          targetDate: null,
          priority: track.priority,
          defaultSessionMinutes: DEFAULT_SESSION_MINUTES,
          status: "ACTIVE",
          origin: "DEMO",
          createdAt: now,
          updatedAt: now,
        });

        for (const objective of buildObjectives(
          track.objectives,
          certificationId,
          null,
          now,
          deps.ids,
        )) {
          await objectives.save(objective);
        }

        return true;
      },
    );

    if (wasInserted) {
      inserted.push(slug);
    } else {
      skipped.push(slug);
    }
  }

  return { inserted, skipped };
}

/** Flattens the demo tree parents-first so foreign keys resolve on insert. */
function buildObjectives(
  demoObjectives: readonly DemoObjective[],
  certificationId: string,
  parentObjectiveId: string | null,
  now: string,
  ids: IdGenerator,
): readonly Objective[] {
  const objectives: Objective[] = [];

  demoObjectives.forEach((demoObjective, index) => {
    const id = ids.nextId();

    objectives.push({
      id,
      certificationId,
      parentObjectiveId,
      code: demoObjective.code,
      title: demoObjective.title,
      description: demoObjective.description,
      weight: null,
      sourceType: DEMO_SOURCE_TYPE,
      displayOrder: index + 1,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });

    objectives.push(
      ...buildObjectives(
        demoObjective.children ?? [],
        certificationId,
        id,
        now,
        ids,
      ),
    );
  });

  return objectives;
}
