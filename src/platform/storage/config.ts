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
