import "server-only";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { getDatabaseContainer } from "@/platform/database/composition";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { GenerationFacade } from "@/modules/ai-generation/application/generation-facade";
import { ObjectiveImportFacade } from "@/modules/ai-generation/application/objective-import-facade";
import { PersonaFacade } from "@/modules/ai-generation/application/persona-facade";
import { SqlitePersonaRepository } from "@/modules/ai-generation/infrastructure/sqlite-persona-repository";
import { UnpdfDocumentTextExtractor } from "@/modules/ai-generation/infrastructure/unpdf-document-text-extractor";
import type { LanguageModelGateway } from "@/modules/ai-generation/ports/language-model-gateway";
import { BedrockLanguageModelGateway } from "@/modules/ai-generation/infrastructure/bedrock-language-model-gateway";
import {
  resolveLanguageModelConfig,
  type LanguageModelConfig,
} from "@/modules/ai-generation/infrastructure/config";
import { FakeLanguageModelGateway } from "@/modules/ai-generation/infrastructure/fake-language-model-gateway";
import { SqliteGenerationRunRepository } from "@/modules/ai-generation/infrastructure/sqlite-generation-run-repository";
import { SqliteGenerationUnitOfWork } from "@/modules/ai-generation/infrastructure/sqlite-generation-unit-of-work";

/**
 * Server-only composition root for AI generation.
 *
 * This is the one place that decides which model the application talks to, and it
 * is the only reason `resolveLanguageModelConfig` is called: the facade, the
 * domain, the routes, and the components never read `process.env`
 * (`spec/ARCHITECTURE.md` section 4).
 *
 * The gateway choice is a wiring decision, which is what makes the whole
 * generation flow runnable with no AWS account: `LANGUAGE_MODEL_PROVIDER=fake`
 * swaps one constructor here and changes nothing else.
 *
 * **Failing loudly in production.** `resolveLanguageModelConfig` throws when
 * `APP_ENV=production` and the provider is anything but `bedrock`, and this
 * function calls it before it builds anything. A production container configured
 * to fabricate demo content therefore fails at composition — on the first request
 * that touches generation — rather than quietly filling the owner's bank with
 * placeholder items (`SPEC.md` section 17). The error names the variable to fix
 * and carries no credential or provider detail.
 *
 * The shared transaction runner is passed through for the same reason as every
 * other module: generation writes questions and cards on the same connection, and
 * `BEGIN` is connection-wide.
 */
export function createGenerationFacade(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
  /**
   * Overrides the configured gateway.
   *
   * Used by the seed script and by integration-style tests that want the fake
   * gateway regardless of the environment. Production callers omit it.
   */
  gateway?: LanguageModelGateway,
): GenerationFacade {
  return new GenerationFacade({
    runs: new SqliteGenerationRunRepository(database),
    questions: new SqliteQuestionRepository(database),
    flashcards: new SqliteFlashcardRepository(database),
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    unitOfWork: new SqliteGenerationUnitOfWork(database, runner),
    gateway: gateway ?? createLanguageModelGateway(),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

/**
 * The gateway the environment asks for.
 *
 * Exhaustive over the provider names, so adding a provider must decide here rather
 * than falling through to a default that would silently be the fake one.
 */
export function createLanguageModelGateway(
  config: LanguageModelConfig = resolveLanguageModelConfig(),
): LanguageModelGateway {
  switch (config.provider) {
    case "bedrock":
      return new BedrockLanguageModelGateway({
        modelId: config.modelId,
        region: config.region,
      });
    case "fake":
      return new FakeLanguageModelGateway();
  }
}

/**
 * Composition for the objective import.
 *
 * Wired here beside the generation facade because it makes the same provider decision
 * and shares the same transaction runner. The one addition is the text extractor, which
 * is the only place `unpdf` is reachable from — a boundary test pins that.
 */
export function createObjectiveImportFacade(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
  gateway?: LanguageModelGateway,
): ObjectiveImportFacade {
  return new ObjectiveImportFacade({
    certifications: new SqliteCertificationRepository(database),
    unitOfWork: new SqliteGenerationUnitOfWork(database, runner),
    gateway: gateway ?? createLanguageModelGateway(),
    extractor: new UnpdfDocumentTextExtractor(),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

/**
 * Composition for persona management.
 *
 * No gateway, no transaction runner, no configuration: managing a persona calls no
 * model and writes one row at a time, so the only dependencies are the repository, the
 * clock, and the identifier source. It lives beside the generation facade because a
 * persona is generation's vocabulary — the next slice hands a stored persona to the
 * prompt builder — not because it shares any wiring with it.
 */
export function createPersonaFacade(database: SqliteDatabase): PersonaFacade {
  return new PersonaFacade({
    personas: new SqlitePersonaRepository(database),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

let facade: GenerationFacade | null = null;

export function getGenerationFacade(): GenerationFacade {
  if (facade === null) {
    const container = getDatabaseContainer();

    facade = createGenerationFacade(container.database, container.transactions);
  }

  return facade;
}

let importFacade: ObjectiveImportFacade | null = null;

export function getObjectiveImportFacade(): ObjectiveImportFacade {
  if (importFacade === null) {
    const container = getDatabaseContainer();

    importFacade = createObjectiveImportFacade(
      container.database,
      container.transactions,
    );
  }

  return importFacade;
}

let personaFacade: PersonaFacade | null = null;

export function getPersonaFacade(): PersonaFacade {
  if (personaFacade === null) {
    personaFacade = createPersonaFacade(getDatabaseContainer().database);
  }

  return personaFacade;
}
