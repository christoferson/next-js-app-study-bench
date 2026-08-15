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
  /**
   * Overrides the configured *review* gateway.
   *
   * Omitted by every caller that does not care, including the seed script: when a
   * caller passes only `gateway`, that one gateway is used for reviewing too, so an
   * explicit fake stays a single fake.
   */
  reviewGateway?: LanguageModelGateway,
): GenerationFacade {
  // Read the environment at most once, and only when something is actually missing: a
  // caller that supplies both gateways — the seed script, an integration test — must
  // not be made to configure an environment it never talks to.
  const configured =
    gateway === undefined || reviewGateway === undefined
      ? createLanguageModelGateways()
      : { generation: gateway, review: reviewGateway };

  return new GenerationFacade({
    runs: new SqliteGenerationRunRepository(database),
    questions: new SqliteQuestionRepository(database),
    flashcards: new SqliteFlashcardRepository(database),
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    personas: new SqlitePersonaRepository(database),
    unitOfWork: new SqliteGenerationUnitOfWork(database, runner),
    gateway: gateway ?? configured.generation,
    // A caller that overrode only the writing gateway gets that same gateway for
    // reviewing: passing one fake must not leave a real provider wired to the review
    // path, which would spend money in a test that asked for none.
    reviewGateway: reviewGateway ?? gateway ?? configured.review,
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

/**
 * Both configured gateways, from one read of the environment.
 *
 * Two instances for Bedrock, one shared instance for the fake provider: the fake calls
 * nothing and spends nothing, so a second copy would only give the two purposes
 * separate scripted-turn counters for no gain.
 */
export function createLanguageModelGateways(
  config: LanguageModelConfig = resolveLanguageModelConfig(),
): {
  readonly generation: LanguageModelGateway;
  readonly review: LanguageModelGateway;
} {
  const generation = createLanguageModelGateway(config, "generation");

  return {
    generation,
    review:
      config.provider === "fake"
        ? generation
        : createLanguageModelGateway(config, "review"),
  };
}

/**
 * The gateway the environment asks for, for one purpose.
 *
 * Exhaustive over the provider names, so adding a provider must decide here rather
 * than falling through to a default that would silently be the fake one.
 *
 * `purpose` picks which configured model id the Bedrock adapter is built with:
 * `"generation"` writes content, `"review"` judges it (`config.ts` states the
 * precedence). Two gateway instances rather than one gateway taking a per-call model
 * override, because the gateway already takes its model id once in its constructor and
 * reports it as `modelId` — which is what the run records and what the generate form
 * shows the owner. Threading an override through every call site would make that
 * property a per-request argument the run would then have to re-derive; building a
 * second instance changes nothing else and keeps "one gateway, one model" true.
 *
 * The fake gateway is not split: it calls nothing and spends nothing, so both purposes
 * share one instance and the substituted-provider tests are unaffected.
 */
export function createLanguageModelGateway(
  config: LanguageModelConfig = resolveLanguageModelConfig(),
  purpose: "generation" | "review" = "generation",
): LanguageModelGateway {
  switch (config.provider) {
    case "bedrock":
      return new BedrockLanguageModelGateway({
        modelId: purpose === "review" ? config.reviewModelId : config.modelId,
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
    personas: new SqlitePersonaRepository(database),
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
 * No gateway, no transaction runner, no configuration: managing a persona calls no model
 * and writes one row at a time. The certification repository is read-only here and is
 * needed for two things a persona is now part of — refusing to delete one a track is
 * assigned, and validating an assignment on the track form. Certifications cannot do
 * either itself without importing this module, which the dependency direction forbids
 * (`spec/ARCHITECTURE.md` section 7).
 */
export function createPersonaFacade(database: SqliteDatabase): PersonaFacade {
  return new PersonaFacade({
    personas: new SqlitePersonaRepository(database),
    certifications: new SqliteCertificationRepository(database),
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
