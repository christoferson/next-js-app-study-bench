/**
 * Local object-storage location.
 *
 * `SPEC.md` section 9.1 fixes the default path: synthesized audio lives under
 * `./data/audio/`, beside the SQLite file and equally uncommitted. The environment
 * override exists so a local experiment can target another directory; tests use
 * temporary directories and never read this value.
 */
export const DEFAULT_AUDIO_STORAGE_ROOT = "./data";

export function resolveAudioStorageRoot(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.STUDYBENCH_AUDIO_ROOT?.trim();

  return configured !== undefined && configured.length > 0
    ? configured
    : DEFAULT_AUDIO_STORAGE_ROOT;
}

/**
 * Where imported source text is written (D8).
 *
 * A second function rather than a rename, because the two roots are configured
 * independently on purpose: audio is regenerable output and a source snapshot is
 * the evidence a generated question cites, so an owner who moves one to a larger
 * disk has no reason to be forced to move the other. Both default to `./data`,
 * where the keys `audio/…` and `sources/…` keep them apart.
 */
export const DEFAULT_SOURCE_STORAGE_ROOT = "./data";

export function resolveObjectStorageRoot(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.STUDYBENCH_SOURCE_ROOT?.trim();

  return configured !== undefined && configured.length > 0
    ? configured
    : DEFAULT_SOURCE_STORAGE_ROOT;
}
