import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DESKTOP_LINUX_GLIBC_FLOOR,
  glibcRequirements,
  newerThanGlibcFloor,
  verifyLinuxGlibcFloor,
} from '../scripts/verify-linux-glibc-floor.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

/** Minimal ELF header: the magic plus padding, enough to be recognised as an ELF file. */
const ELF_HEADER = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]), Buffer.alloc(56)])

function fixture(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-glibc-floor-'))
  directories.push(root)
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), contents)
  }
  return root
}
/**
 * Stand in for binutils: the report is keyed by the scanned path, so a fixture decides what each file needs.
 * @param needs - glibc version each scanned file reports needing; every other file needs GLIBC_2.2.5.
 * @returns A directory to put on PATH in place of the real toolchain.
 */
function readelfStub(needs: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-readelf-'))
  directories.push(directory)
  mkdirSync(join(directory, 'bin'), { recursive: true })
  writeFileSync(join(directory, 'bin', 'readelf'), [
    '#!/bin/sh',
    'echo "Version needs section \'.gnu.version_r\' contains 1 entry:"',
    ...Object.entries(needs).map(([file, version]) =>
      `if [ "$3" = "${file}" ]; then echo "  0x0010: Name: GLIBC_${version} Flags: none Version: 3"; exit 0; fi`),
    'echo "  0x0010: Name: GLIBC_2.2.5 Flags: none Version: 2"',
    '',
  ].join('\n'), { mode: 0o755 })
  return join(directory, 'bin')
}

function withPath(directory: string, action: () => void): void {
  const previous = process.env.PATH
  process.env.PATH = directory
  try { action() } finally { process.env.PATH = previous }
}

describe('Linux glibc floor', () => {
  it('pins the packaged application to the AlmaLinux 8 glibc', () => {
    expect(DESKTOP_LINUX_GLIBC_FLOOR).toBe('2.28')
  })

  it('reads required glibc versions from the needs section only', () => {
    const report = [
      "Version symbols section '.gnu.version' contains 62 entries:",
      '  0x0001: Name: GLIBC_2.34 Flags: none Version: 5',
      '',
      "Version definition section '.gnu.version_d' contains 1 entry:",
      '  0x0001: Rev: 1  Flags: BASE  Index: 1  Cnt: 1  Name: libprobe.so',
      '',
      "Version needs section '.gnu.version_r' contains 3 entries:",
      '  0x0000: Version: 1  File: libc.so.6  Cnt: 3',
      '  0x0010: Name: GLIBC_2.34 Flags: none Version: 3',
      '  0x0020: Name: GLIBC_2.2.5 Flags: none Version: 2',
      '  0x0030: Name: GLIBC_2.2.5 Flags: none Version: 4',
      '',
    ].join('\n')
    expect(glibcRequirements(report)).toEqual(['2.34', '2.2.5'])
  })

  it.each([
    ['2.29', true], ['2.34', true], ['3.0', true], ['2.28', false], ['2.2.5', false], ['2.17', false],
  ])('compares %s against the floor', (version, newer) => {
    expect(newerThanGlibcFloor(version, '2.28')).toBe(newer)
  })

  it('reports a directory without ELF files instead of passing it', () => {
    const root = fixture({ 'resources/readme.txt': 'not a binary\n' })
    expect(() => verifyLinuxGlibcFloor(root)).toThrow(/contains no ELF files/u)
  })

  it('reports a missing readelf before claiming the artifacts are portable', () => {
    const root = fixture({ 'deepseek-harness': ELF_HEADER })
    const previous = process.env.PATH
    process.env.PATH = join(root, 'empty-path')
    try {
      expect(() => verifyLinuxGlibcFloor(root)).toThrow(/readelf is unavailable; install binutils on the Linux build host/u)
    } finally { process.env.PATH = previous }
  })

  it('accepts an application whose newest requirement is the floor', () => {
    const root = fixture({ 'electron': ELF_HEADER, 'resources/native/libprobe.so': ELF_HEADER, 'resources/readme.txt': 'text\n' })
    const stub = readelfStub({ [join(root, 'electron')]: '2.28' })
    withPath(stub, () => {
      expect(verifyLinuxGlibcFloor(root)).toEqual({ files: 2, newest: '2.28' })
    })
  })

  it('names every file that requires a newer glibc', () => {
    const root = fixture({ 'electron': ELF_HEADER, 'resources/native/libprobe.so': ELF_HEADER })
    const stub = readelfStub({ [join(root, 'resources/native/libprobe.so')]: '2.34' })
    withPath(stub, () => {
      expect(() => verifyLinuxGlibcFloor(root)).toThrow([
        'desktop glibc: artifacts require glibc newer than 2.28:',
        `  2.34  ${join(root, 'resources/native/libprobe.so')}`,
      ].join('\n'))
    })
  })
})
