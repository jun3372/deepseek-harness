/** Resolve a GitHub Actions Linux build version and validate the unsigned packaging mode. */
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { desktopCiVersion } from './desktop-ci-version.mjs'
import { localUnsignedPackageEnvironment, validateDesktopPackageEnvironment } from './desktop-package-environment.mjs'

const arch = process.env.PACKAGE_ARCH ?? 'x64'
if (arch !== 'x64' && arch !== 'arm64') throw new Error('desktop package: PACKAGE_ARCH must be x64 or arm64')
const appRoot = resolve(import.meta.dirname, '..')
const product = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8'))
const version = desktopCiVersion(process.env, product.version)
// Linux packaging is unsigned and feed-free, so the local defaults are the whole environment.
validateDesktopPackageEnvironment(localUnsignedPackageEnvironment(), { platform: 'linux', arch }, { unsigned: true })
if (!process.env.GITHUB_OUTPUT || !process.env.GITHUB_STEP_SUMMARY) throw new Error('Run this adapter from GitHub Actions')
appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntarget=linux-${arch}\narchitecture=${arch}\nartifacts=unsigned-artifacts\nmode=unsigned\n`)
appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Linux ${arch} unsigned installers\n\nVersion: ${version}\n\nCommit: ${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\n\nSource: ${process.env.PACKAGE_SOURCE_REF}\n`)
appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\nWARNING: unsigned AppImage, DEB and RPM with no update feed. Community distribution only.\n')
