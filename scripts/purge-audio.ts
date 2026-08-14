/**
 * One-off: remove every stored audio clip.
 *
 * Written to clear the silent clips the placeholder speech provider produced before the
 * provider check existed. Deletion goes through `AudioFacade.delete`, the same path
 * `/settings/audio` uses, so the row and its file are removed in the same order and an
 * orphaned file is impossible.
 *
 * The gateway is the placeholder one because nothing here synthesizes; it exists only to
 * satisfy the facade's dependencies.
 */
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { resolveDatabaseFile } from "@/platform/database/config";
import { runMigrations } from "@/platform/database/migration-runner";
import { openSqliteDatabase } from "@/platform/database/sqlite";
import { resolveAudioStorageRoot } from "@/platform/storage/config";
import { LocalFileObjectStorage } from "@/platform/storage/local-file-object-storage";
import { AudioFacade } from "@/modules/audio/application/audio-facade";
import { FakeSpeechSynthesisGateway } from "@/modules/audio/infrastructure/fake-speech-synthesis-gateway";
import { SqliteMediaAssetRepository } from "@/modules/audio/infrastructure/sqlite-media-asset-repository";

async function main(): Promise<void> {
  const file = resolveDatabaseFile();
  const database = openSqliteDatabase(file);

  try {
    runMigrations(database);

    const facade = new AudioFacade({
      assets: new SqliteMediaAssetRepository(database),
      storage: new LocalFileObjectStorage(resolveAudioStorageRoot()),
      gateway: new FakeSpeechSynthesisGateway(),
      voices: { voiceIdZh: "Zhiyu", voiceIdEn: "Joanna", engine: "neural" },
      clock: systemClock,
      ids: cryptoIdGenerator,
    });

    const before = await facade.findLibrary();

    console.log(`Database: ${file}`);
    console.log(`Stored clips before: ${before.totalCount}`);

    for (const asset of before.assets) {
      console.log(`Removing ${asset.id} (${asset.byteSize} bytes)`);
      await facade.delete(asset.id);
    }

    const after = await facade.findLibrary();

    console.log(`Stored clips after: ${after.totalCount}`);
  } finally {
    database.close();
  }
}

void main();
