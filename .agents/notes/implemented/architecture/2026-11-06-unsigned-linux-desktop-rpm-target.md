# Agent Note: Unsigned Linux Desktop installers with a glibc 2.28 floor

Status: implemented

English | [中文](2026-11-06-unsigned-linux-desktop-rpm-target.zh.md)

## Problem

Desktop had only macOS and Windows targets, so Linux users could not install the application from a supported package. Building Linux artifacts on a contemporary runner risks silently raising the glibc floor of the shipped binaries, because electron-builder resolves libc symbols on the build host. A release-channel installer would also require signing, an update feed, and retained release records that no Linux deployment owns.

## Decision

Package Linux x64 as unsigned AppImage, DEB, and RPM only. The `package:desktop:linux:x64` command uses the same local unsigned environment as the unsigned macOS commands, and Linux packaging refuses a signed mode outright: no dotenv or machine preset, no mandatory-update policy, no update feed, no `app-update.yml`, and no release completion record. Upload and retention therefore reject Linux targets; the workflow artifact is the distribution channel.

Enforce glibc 2.28 mechanically instead of pinning a build distribution. After electron-builder assembles the unpacked application, `apps/desktop/scripts/verify-linux-glibc-floor.ts` walks every ELF file and reads its required versions from the `Version needs section` of `readelf --version-info`. A file requiring anything newer than 2.28 fails the build and is listed by name. Lowering the floor is never an option; a newer Electron or native prebuild is the input to change. `--dir` builds stop before this scan, since they exist for inspecting the assembled tree.

Verify offline usability in CI rather than by inspection. The workflow builds an AlmaLinux 8 image carrying the RPM's declared dependencies, installs the built RPM with every repository disabled under `--network none`, and inside that container checks the Electron-as-Node runtime, the bundled Node and Python with their Office libraries, pnpm, the seven Office skills, the CLI launcher, and the absence of update configuration. This proves installation and the embedded tool payloads; it deliberately excludes GUI rendering and account sign-in.

Linux arm64 stays in the target tables as a recognized build target but ships no script, workflow, or documented artifact; it needs its own runner and qualification before being offered.

Linux Office conversion uses the kit's WASM engine, because no native Linux engine is declared. Electron's ASAR filesystem answers `null` rather than `undefined` for missing entries, which made the kit's installed-package probe report a nonexistent native engine as present and abort the WASM fallback inside the packaged application. A shared `@deepseek-ai/libreoffice-kit@0.1.5` patch therefore counts only real directories, restoring the documented fallback.

## Consequences

Linux installers are unsigned workflow artifacts with a 14-day retention window, so no update feed, release store entry, or publication route exists for them. Every rebuild re-derives the runtime lockfile and scans the assembled binaries, so an Electron upgrade that raises the floor fails packaging instead of shipping. Adding a signed or arm64 Linux release requires its own runner, credentials, and qualification and is not part of this decision.

The gate identified exactly one binary above the floor: `sherpa-onnx-linux-x64`, whose 1.13.5 and later prebuilds require glibc 2.32. The Desktop runtime pins that package to 1.13.4, whose newest requirement is glibc 2.14, through the reviewed dependency overrides rather than excluding the experimental speech-to-text engine or weakening the floor.

## Alternatives considered

Publishing only an AppImage would avoid the DEB and RPM toolchain but would not give Linux users a system-integrated package with the dependency declarations this workflow verifies offline. Signing Linux artifacts or adding a generic update feed was rejected because no Linux signing identity, feed bucket, or retention store is owned today. Raising the glibc floor to match the current build runner was rejected because it would silently drop every distribution older than that runner.

The FPM-based targets carry metadata the other platforms never needed: the application declares a project `homepage`, `deb` and `rpm` name the system package `deepseek-harness` instead of the spaced display name, and the RPM passes `_build_id_links none` so rpmbuild does not write shared `/usr/lib/.build-id` links that collide with other packages during installation. The RPM requirements are electron-builder's defaults plus the ALSA and GBM libraries Electron links, which is what the offline container preinstalls.

## Verification

Unit tests cover target and host validation, the unsigned-only invocation rule, Linux builder configuration, packing concurrency, the absence of a release record, and the gate's report parsing, version comparison, missing-`readelf` report, and offending-file report against a stub `readelf`. The workflow performs the end-to-end packaging and offline RPM installation; the packaging guide's Linux section owns the commands and limits.
