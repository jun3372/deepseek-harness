/** Resolve Linux packaging concurrency. */

/**
 * Validate the worker limit before any build or archive operation starts.
 * @param environment Loaded packaging settings and inherited build environment.
 * @returns Worker limit defaulting to four.
 */
export function resolveLinuxPackageSettings(
  environment: NodeJS.ProcessEnv,
): { packConcurrency: number }
