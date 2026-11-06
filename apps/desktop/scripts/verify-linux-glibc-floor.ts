/**
 * Enforce the glibc floor of the packaged Linux application.
 *
 * electron-builder resolves libc symbols where it runs, so a newer build host silently raises the
 * floor of the shipped binaries. Every ELF file of the unpacked application is scanned instead of
 * trusting the host that produced it.
 */

import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  desktopArtifactOutput,
  desktopTargetBuildPaths,
  desktopUnpackedApplicationDirectory,
  resolveDesktopBuildTarget,
} from './desktop-build-paths.mjs'

/** Highest glibc version the packaged Linux application may require. */
export const DESKTOP_LINUX_GLIBC_FLOOR = '2.28'

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46])
const GLIBC_SYMBOL = /\bGLIBC_(?<version>\d+(?:\.\d+)+)/gu

/** One shipped file that requires a glibc version above the floor. */
export interface GlibcOffender {
  readonly version: string
  readonly file: string
}

/** Outcome of scanning one unpacked application against the glibc floor. */
export interface LinuxGlibcScan {
  readonly files: number
  readonly newest: string
}

/**
 * Read the glibc versions one `readelf --version-info` report requires.
 * A binary also defines its own GLIBC versions, so only the needs section counts.
 * @param report - Complete `readelf --version-info --wide` output.
 * @returns Distinct glibc versions named by the needs section, in report order.
 */
export function glibcRequirements(report: string): string[] {
  const versions = new Set<string>()
  let needsSection = false
  for (const line of report.split('\n')) {
    if (/^\s*Version \w+ section/u.test(line)) needsSection = /^\s*Version needs section/u.test(line)
    if (!needsSection) continue
    for (const match of line.matchAll(GLIBC_SYMBOL)) {
      if (match.groups?.version !== undefined) versions.add(match.groups.version)
    }
  }
  return [...versions]
}

/**
 * Compare one glibc version against the floor.
 * @param version - Version as `major.minor` or `major.minor.patch`.
 * @param floor - Floor as `major.minor`.
 * @returns Whether the version is newer than the floor.
 */
export function newerThanGlibcFloor(version: string, floor: string): boolean {
  const [requiredMajor = 0, requiredMinor = 0] = version.split('.').map(Number)
  const [allowedMajor = 0, allowedMinor = 0] = floor.split('.').map(Number)
  return requiredMajor !== allowedMajor ? requiredMajor > allowedMajor : requiredMinor > allowedMinor
}

function isElfFile(path: string): boolean {
  const descriptor = openSync(path, 'r')
  try {
    const header = Buffer.alloc(ELF_MAGIC.length)
    return readSync(descriptor, header, 0, ELF_MAGIC.length, 0) === ELF_MAGIC.length && header.equals(ELF_MAGIC)
  }
  finally { closeSync(descriptor) }
}

function elfFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...elfFiles(path))
    else if (entry.isFile() && isElfFile(path)) files.push(path)
  }
  return files
}

function readelfVersionInfo(path: string): string {
  try {
    return execFileSync('readelf', ['--version-info', '--wide', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('desktop glibc: readelf is unavailable; install binutils on the Linux build host')
    }
    throw error
  }
}

/**
 * Scan every ELF file of one unpacked application for glibc requirements above the floor.
 * @param application - Unpacked application directory electron-builder produced.
 * @param floor - Highest permitted glibc version as `major.minor`.
 * @returns Number of scanned ELF files and the newest glibc version they require.
 * @throws When no ELF file exists or one requires a version above the floor, naming every such file.
 */
export function verifyLinuxGlibcFloor(
  application: string,
  floor: string = DESKTOP_LINUX_GLIBC_FLOOR,
): LinuxGlibcScan {
  const files = elfFiles(application)
  if (files.length === 0) throw new Error(`desktop glibc: ${application} contains no ELF files`)
  const offenders: GlibcOffender[] = []
  let newest = '0'
  for (const file of files) {
    for (const version of glibcRequirements(readelfVersionInfo(file))) {
      if (newerThanGlibcFloor(version, newest)) newest = version
      if (newerThanGlibcFloor(version, floor)) offenders.push({ version, file })
    }
  }
  if (offenders.length > 0) {
    throw new Error(`desktop glibc: artifacts require glibc newer than ${floor}:\n${
      offenders.map(offender => `  ${offender.version}  ${offender.file}`).join('\n')}`)
  }
  return { files: files.length, newest }
}

/**
 * Scan the unpacked application of the target selected by the packaging environment.
 * @returns Number of scanned ELF files and the newest glibc version they require.
 * @throws When the artifacts, the floor, or `readelf` are unavailable.
 */
export function verifyCurrentLinuxGlibcFloor(): LinuxGlibcScan {
  const target = resolveDesktopBuildTarget()
  const artifacts = desktopArtifactOutput(desktopTargetBuildPaths(target), { unsigned: true, skipNotarization: false }).directory
  return verifyLinuxGlibcFloor(join(artifacts, desktopUnpackedApplicationDirectory(target)))
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const { files, newest } = verifyCurrentLinuxGlibcFloor()
  process.stdout.write(`desktop package: ${files} Linux ELF files require at most glibc ${newest}; floor ${DESKTOP_LINUX_GLIBC_FLOOR}\n`)
}
