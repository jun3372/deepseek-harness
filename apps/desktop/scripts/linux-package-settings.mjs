/** Resolve Linux packaging concurrency. */

/**
 * Validate the worker limit before any build or archive operation starts.
 * @param {NodeJS.ProcessEnv} environment Loaded packaging settings and inherited build environment.
 * @returns {{packConcurrency: number}} Worker limit defaulting to four.
 */
export function resolveLinuxPackageSettings(environment) {
  const concurrency = environment.DSH_DESKTOP_LINUX_PACK_CONCURRENCY ?? '4'
  if (!/^[1-9]\d*$/u.test(concurrency) || !Number.isSafeInteger(Number(concurrency))) {
    throw new Error('desktop package: DSH_DESKTOP_LINUX_PACK_CONCURRENCY must be a positive integer')
  }
  return { packConcurrency: Number(concurrency) }
}
