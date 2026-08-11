/**
 * Local database location.
 *
 * `SPEC.md` section 9.1 fixes the default path. The environment override exists
 * so the seed script and any local experiment can target another file; tests use
 * in-memory databases and never read this value.
 */
export const DEFAULT_DATABASE_FILE = "./data/study-bench.db";

export function resolveDatabaseFile(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.STUDYBENCH_DATABASE_FILE?.trim();

  return configured !== undefined && configured.length > 0
    ? configured
    : DEFAULT_DATABASE_FILE;
}
