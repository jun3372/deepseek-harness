import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { expect, it } from 'vitest'

interface SourceFixture {
  /** Commit the fixture tagged dsh-v1.0.0 and dsh-v2.0.0 on. */
  readonly sha: string
  readonly git: (...args: string[]) => string
  readonly run: (preset: string | undefined, ref: string) => SpawnSyncReturns<string>
  readonly writeAdapter: (name: string, contents: string) => void
}

/** Contents that satisfy one workflow's adapter support check. */
const ADAPTER_STUBS: Record<string, string> = {
  'desktop-ci-version.mjs': 'PACKAGE_VERSION_MODE',
  'prepare-linux-ci.mjs': 'PACKAGE_ARCH',
  'retain-desktop-ci.ts': '--check-runner',
}

/**
 * Run a packaging workflow's source validation script against a disposable repository clone.
 * @param workflow - Workflow whose `Validate selected source and adapter support` step is under test.
 * @param action - Assertions over the fixture's git history and validation runs.
 */
function withDesktopSourceFixture(
  workflow: string,
  action: (fixture: SourceFixture) => void,
): void {
  const parsed = yaml.load(readFileSync(resolve(import.meta.dirname, `../.github/workflows/${workflow}`), 'utf8')) as {
    jobs: { package: { steps: Array<{ name?: string; run?: string }> } }
  }
  const command = parsed.jobs.package.steps.find(step => step.name === 'Validate selected source and adapter support')!.run!
  expect(command.startsWith('node -e "')).toBe(true)
  expect(command.endsWith('"')).toBe(true)
  const script = command.slice('node -e "'.length, -1)
  const root = mkdtempSync(join(tmpdir(), 'desktop-source-'))
  try {
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_CONFIG_PARAMETERS: '',
      GIT_CONFIG_COUNT: '0', GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined }
    const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'tag.gpgSign=false', ...args],
      { cwd: root, env, encoding: 'utf8', stdio: 'pipe' }).trim()
    git('init', '--initial-branch=master')
    mkdirSync(join(root, 'apps/desktop/scripts'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"version":"1.0.0"}')
    for (const [name, contents] of Object.entries(ADAPTER_STUBS)) writeFileSync(join(root, 'apps/desktop/scripts', name), contents)
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
    const sha = git('rev-parse', 'HEAD')
    git('tag', 'dsh-v1.0.0')
    git('tag', 'dsh-v2.0.0')
    const run = (preset: string | undefined, ref: string) => spawnSync(process.execPath, ['-e', script], {
      cwd: root, encoding: 'utf8',
      env: { ...env, ...(preset === undefined ? {} : { DSH_PACKAGING_PRESET: preset }), PACKAGE_SOURCE_REF: ref },
    })
    const writeAdapter = (name: string, contents: string): void => { writeFileSync(join(root, 'apps/desktop/scripts', name), contents) }
    action({ sha, git, run, writeAdapter })
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }) }
}

it.each(['macos', 'windows'])('%s packaging accepts test branches but preserves production and tag restrictions', (platform) => {
  withDesktopSourceFixture(`${platform}-package.yml`, ({ sha, git, run, writeAdapter }) => {
    for (const preset of ['test', 'production']) expect(run(preset, 'master').status).toBe(0)
    git('checkout', '-b', 'feature/desktop-update')
    expect(run('test', 'feature/desktop-update').status).toBe(0)
    expect(run('production', 'feature/desktop-update').status).not.toBe(0)
    for (const ref of ['refs/pull/42/head', 'refs/heads/feature/desktop-update']) {
      expect(run('test', ref).status).not.toBe(0)
    }
    expect(run('unknown', 'feature/desktop-update').status).not.toBe(0)
    git('checkout', '--detach', 'HEAD')
    for (const ref of [sha, 'master', 'HEAD', 'refs/pull/42/head']) {
      const result = run('test', ref)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Select a branch in this repository, not a SHA or PR ref')
    }
    for (const preset of ['test', 'production']) expect(run(preset, 'dsh-v1.0.0').status).toBe(0)
    expect(run('test', 'dsh-v2.0.0').status).not.toBe(0)
    writeAdapter('retain-desktop-ci.ts', 'old archival adapter')
    expect(run('test', 'dsh-v1.0.0').stderr).toContain('independent Desktop artifact archival support')
    writeAdapter('retain-desktop-ci.ts', ADAPTER_STUBS['retain-desktop-ci.ts']!)
    writeAdapter('desktop-ci-version.mjs', 'old adapter')
    expect(run('test', 'dsh-v1.0.0').status).not.toBe(0)
  })
})

it('linux packaging accepts any repository branch but keeps the tag and adapter restrictions', () => {
  withDesktopSourceFixture('linux-package.yml', ({ sha, git, run, writeAdapter }) => {
    expect(run(undefined, 'master').status).toBe(0)
    git('checkout', '-b', 'feature/linux-package')
    expect(run(undefined, 'feature/linux-package').status).toBe(0)
    for (const ref of ['refs/pull/42/head', 'refs/heads/feature/linux-package']) {
      expect(run(undefined, ref).status).not.toBe(0)
    }
    git('checkout', '--detach', 'HEAD')
    for (const ref of [sha, 'master', 'HEAD', 'refs/pull/42/head']) {
      const result = run(undefined, ref)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Select a branch in this repository, not a SHA or PR ref')
    }
    expect(run(undefined, 'dsh-v1.0.0').status).toBe(0)
    expect(run(undefined, 'dsh-v2.0.0').status).not.toBe(0)
    writeAdapter('prepare-linux-ci.mjs', 'old adapter')
    expect(run(undefined, 'dsh-v1.0.0').stderr).toContain('Source lacks Desktop Linux CI support')
  })
})
