# Agent Note：带 glibc 2.28 下限的未签名 Linux Desktop 安装包

状态：已实现

[English](2026-11-06-unsigned-linux-desktop-rpm-target.md) | 中文

## 问题

Desktop 此前只有 macOS 与 Windows 目标，Linux 用户没有受支持的安装包可用。在较新的构建机上生成 Linux 产物可能悄悄抬高所交付二进制的 glibc 下限，因为 electron-builder 会在构建机上解析 libc 符号。而发布通道的安装包还需要签名、更新源与留存发布记录，当前没有任何 Linux 部署负责这些事项。

## 决策

只打包 Linux x64，且只产出未签名的 AppImage、DEB 与 RPM。`package:desktop:linux:x64` 使用与未签名 macOS 命令相同的本地未签名环境，Linux 打包直接拒绝签名模式：不使用 dotenv 或机器预设，不带强制更新策略，不带更新源，不写 `app-update.yml`，也不生成发布完成记录。因此上传与留存都拒绝 Linux 目标，工作流产物的分发通道就是 Actions artifact。

glibc 2.28 下限由机械检查强制，而不是靠固定构建发行版。electron-builder 组装出未打包的应用目录后，`apps/desktop/scripts/verify-linux-glibc-floor.ts` 遍历所有 ELF 文件，从 `readelf --version-info` 的 `Version needs section` 读取其要求的版本。任何要求高于 2.28 的文件都会让构建失败并按名列出。绝不放宽该下限；需要调整的是更旧的 Electron 或原生预编译产物这一输入。`--dir` 构建在该扫描之前停止，因为它用于查看组装后的目录树。

离线可用性在 CI 中验证，而不是靠推断。工作流构建一个预装 RPM 声明依赖的 AlmaLinux 8 镜像，在 `--network none` 下禁用所有仓库安装该 RPM，并在容器内检查 Electron-as-Node 运行时、内置 Node 与 Python 及其 Office 依赖库、pnpm、7 个 Office 技能、CLI 启动器，以及不存在更新配置。这证明了安装与内置工具载荷，明确不包含 GUI 渲染与账号登录。

Linux arm64 仍保留在目标表中作为可识别的构建目标，但不提供脚本、工作流或文档化的产物；对外提供前需要独立的 runner 与验收。

## 影响

Linux 安装包是保留 14 天的未签名工作流 artifact，因此没有更新源、发布存储条目或发布通道。每次重建都会重新解析运行时锁文件并扫描组装后的二进制，所以抬高下限的 Electron 升级会让打包失败，而不是把产物发出去。新增签名或 arm64 的 Linux 发布需要独立的 runner、凭证与验收，不在本决策范围内。

## 备选方案

只发布 AppImage 可以省掉 DEB 与 RPM 工具链，但无法给 Linux 用户提供带依赖声明、并能被本工作流离线验证的系统级安装包。为 Linux 产物签名或增加通用更新源被否决，因为目前没有对应的签名身份、feed 存储桶或留存存储。把 glibc 下限提高到当前构建 runner 的水平同样被否决，因为它会静默放弃所有比该 runner 更旧的发行版。

FPM 类目标需要其他平台用不到的元数据：应用声明项目 `homepage`，`deb` 与 `rpm` 把系统包名设为 `deepseek-harness` 而不是带空格的显示名，RPM 传入 `_build_id_links none`，避免 rpmbuild 写入与其他软件包冲突的共享 `/usr/lib/.build-id` 链接。RPM 依赖为 electron-builder 默认集合加上 Electron 实际链接的 ALSA 与 GBM 库，离线容器预装的正是这套依赖。

## 验证

单元测试覆盖目标与宿主校验、仅未签名的调用规则、Linux 构建器配置、打包并发、不生成发布记录，以及门禁的报告解析、版本比较、缺少 `readelf` 的报错和超标文件报错（使用桩 `readelf`）。端到端打包与离线 RPM 安装由工作流执行；打包指南的 Linux 章节负责命令与适用范围。
