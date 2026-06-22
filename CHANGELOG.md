# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.9.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.9.0...v1.9.1) (2026-06-22)

### Code Refactoring

- migrate to @agentclientprotocol/sdk 0.29 fluent client API ([b5ca20e](https://github.com/pengjiantao/vscode-acp-chat/commit/b5ca20e0a6767875837e7e67e15c5415f4126769))

## [1.9.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.8.2...v1.9.0) (2026-06-22)

### Features

- per-model thought_level preference tracking ([856765a](https://github.com/pengjiantao/vscode-acp-chat/commit/856765a57a2a371cf4d290e79ac02ed514975112))

### [1.8.2](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.8.1...v1.8.2) (2026-06-22)

### Bug Fixes

- compact options bar layout and improve narrow-width responsiveness ([136ed6a](https://github.com/pengjiantao/vscode-acp-chat/commit/136ed6ab9291108b33037a3ed7fa4855f8ca0fb6))

### [1.8.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.8.0...v1.8.1) (2026-06-21)

### Bug Fixes

- only use IO block rendering for execute tools ([f1471aa](https://github.com/pengjiantao/vscode-acp-chat/commit/f1471aafa1b5d8cd9f33b4e7f0b30d5aa9e5d88a))

## [1.8.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.7.0...v1.8.0) (2026-06-21)

### Features

- **webview:** simplify edit/write tool details to show only diff ([637fc5a](https://github.com/pengjiantao/vscode-acp-chat/commit/637fc5aa3e160675a74f5a2b3d64ebcbda469280))

### Bug Fixes

- prioritize intent field over directory path in execute tool summary ([c5323bd](https://github.com/pengjiantao/vscode-acp-chat/commit/c5323bd083913a3c52f4b3feb2256d57e0cc504c))

### Code Refactoring

- unified IO block for tool call details ([9f3bf36](https://github.com/pengjiantao/vscode-acp-chat/commit/9f3bf3678a17311aad0984c91b97a6ac99e017f1))
- use border-left color instead of icons for tool status ([50a2c52](https://github.com/pengjiantao/vscode-acp-chat/commit/50a2c521d87c24e963fd67afb496dfc974208f47))

## [1.7.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.6.1...v1.7.0) (2026-06-21)

### Features

- add confirmation dialog when agent is generating ([b27bbf5](https://github.com/pengjiantao/vscode-acp-chat/commit/b27bbf56a0e7ed84c3709a1c7d51f3c4664a3bfc))

### Bug Fixes

- prevent duplicate message sends while agent is generating ([d54668a](https://github.com/pengjiantao/vscode-acp-chat/commit/d54668a43e7cd4654e0cb19b25772ba5621fef96))

### [1.6.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.6.0...v1.6.1) (2026-06-21)

### Bug Fixes

- reduce visual gaps between adjacent blocks in chat UI ([c54edb5](https://github.com/pengjiantao/vscode-acp-chat/commit/c54edb5c931a030795cc95c1fbe58a8376c6e411))
- resolve diff rendering marking all lines as deleted ([94757b9](https://github.com/pengjiantao/vscode-acp-chat/commit/94757b97d1af4e45ddbedaaf0dfc55668f9ee5a1))

## [1.6.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.5.1...v1.6.0) (2026-06-20)

### Features

- 添加 CodeBuddy Code ACP agent 支持 ([8be17bc](https://github.com/pengjiantao/vscode-acp-chat/commit/8be17bcdc35d1f15ab7b2ea906b49ac22fc34f65))
- 添加上下文使用量指示器 ([1323d44](https://github.com/pengjiantao/vscode-acp-chat/commit/1323d44d3b1b31a574093786e3ca8f1e4361c1ed))
- 支持通用 config options 下拉（含 thought_level） ([f2b69b4](https://github.com/pengjiantao/vscode-acp-chat/commit/f2b69b442bd416e8a259260a2cf2d7dad57a6d67))
- add ACP document sync notifications ([7a0a397](https://github.com/pengjiantao/vscode-acp-chat/commit/7a0a3976256cd608523f23d12e79350ff2f367b0))

### Bug Fixes

- update Claude Code ACP package name to @agentclientprotocol/claude-agent-acp ([c49e1e0](https://github.com/pengjiantao/vscode-acp-chat/commit/c49e1e058d07c6251aaed3a11471e57ca86a4c4f))

### [1.5.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.5.0...v1.5.1) (2026-06-19)

### Bug Fixes

- pretty-print object values in tool input display to avoid [object Object] ([3d8d3f1](https://github.com/pengjiantao/vscode-acp-chat/commit/3d8d3f161fa81e2971f50a5b7f96cecb8c471089))

### Code Refactoring

- replace any with proper types for improved type safety ([68632db](https://github.com/pengjiantao/vscode-acp-chat/commit/68632db039f0276ed8fe64254e73b81aac347af7))

## [1.5.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.4.0...v1.5.0) (2026-06-08)

### Features

- upgrade ACP SDK to 0.21.0 and add configOptions protocol support ([8f33c90](https://github.com/pengjiantao/vscode-acp-chat/commit/8f33c905da544cc7a8a3a3f0a00242d8704f090b))

## [1.4.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.3.0...v1.4.0) (2026-05-14)

### Bug Fixes

- add scrollToBottom after message finalization and reduce button gap ([60873f0](https://github.com/pengjiantao/vscode-acp-chat/commit/60873f0563331349d00752730ac1e9a810db8ca1))
- **webview:** fix double-click bug when switching between dropdowns ([b169448](https://github.com/pengjiantao/vscode-acp-chat/commit/b169448d2ec1796bb8c38ba1d013b874847c64bf))

## [1.3.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.2.0...v1.3.0) (2026-05-12)

### Features

- **chat:** migrate preferences to agent-scoped storage and add starred models backend ([785766e](https://github.com/pengjiantao/vscode-acp-chat/commit/785766e090046e6c76e314181f9c2926db0591f4))

### Bug Fixes

- **webview:** preserve scroll position when auto-resizing input textarea ([0033d1c](https://github.com/pengjiantao/vscode-acp-chat/commit/0033d1c663ae26bff51deebb1846ca90ab5cf8f7))
- **webview:** track auto-scroll state as class field ([f80da15](https://github.com/pengjiantao/vscode-acp-chat/commit/f80da15af366bc330ba54eb93000589c67ff8f54))
- 修复 Webview 中 IME 输入导致的重复字符问题 ([3406107](https://github.com/pengjiantao/vscode-acp-chat/commit/3406107442515cb1db2136902eb47ed595e17f11))

## [1.2.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.1.1...v1.2.0) (2026-04-26)

### Features

- **agents:** add project-specific agent skills ([e75f1e9](https://github.com/pengjiantao/vscode-acp-chat/commit/e75f1e91d88c3a8e1d869e0af86e974355ded337))
- **webview:** add message action buttons and improve turn separation ([d8a68df](https://github.com/pengjiantao/vscode-acp-chat/commit/d8a68df6994bc885ebb67f1e7b213fb7083e94b4))
- **webview:** add slash command chips for user messages ([8c0f138](https://github.com/pengjiantao/vscode-acp-chat/commit/8c0f138b83520a07c1e90c0c083eedeaf36bda30))

### Bug Fixes

- prevent dropdown and tooltip overflow at viewport edges ([9974516](https://github.com/pengjiantao/vscode-acp-chat/commit/997451635c8f6a0823c220257663ed6b24a7d555))
- update autocomplete to use global offsets and fix related bugs ([9107190](https://github.com/pengjiantao/vscode-acp-chat/commit/91071900b3b7ebd52cd8a1b21bf0c2bab928b12b))

### Performance Improvements

- **webview:** optimize autocomplete rendering and improve focus management ([03cf7e0](https://github.com/pengjiantao/vscode-acp-chat/commit/03cf7e05afff54bf2bafc06e7159fd471b8bf5fa))

## [1.1.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.1.0...v1.1.1) (2026-04-24)

### Bug Fixes

- **webview:** ensure diff line background covers full width when scrolling ([119caa4](https://github.com/pengjiantao/vscode-acp-chat/commit/119caa4d07023d7b2d7bc1d817ff00f3ec15a873))

## [1.1.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.0.1...v1.1.0) (2026-04-24)

### Features

- add custom agent configuration with override support ([e13ae3a](https://github.com/pengjiantao/vscode-acp-chat/commit/e13ae3a073ffd76f1472bd6e4f813db3ca87876c))
- add http/sse transport support for MCP server configuration ([7b5b2e6](https://github.com/pengjiantao/vscode-acp-chat/commit/7b5b2e6d8edaab1854e0a606d38e8b15c5519b73))
- add MCP client integration ([b5ddb2a](https://github.com/pengjiantao/vscode-acp-chat/commit/b5ddb2a8581febe4554634df140608191c1b48b4))
- add optional MCP server passthrough configuration ([866b1df](https://github.com/pengjiantao/vscode-acp-chat/commit/866b1dfbd94223a6f658fb4b62f6b542ec7f7cd4))
- update cursor agent command to cursor-agent ([a022576](https://github.com/pengjiantao/vscode-acp-chat/commit/a022576ea4006eca8f2309698a847f262e642df8))

### Bug Fixes

- update icon for ToolKind.other from gear to tools ([7bd0b98](https://github.com/pengjiantao/vscode-acp-chat/commit/7bd0b9839bf138b7a36dc844bab939551c235519))

## [1.0.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.0.0...v1.0.1) (2026-04-20)

### Bug Fixes

- resolve chat UI issues, optimize loading and add Cursor integration ([0150413](https://github.com/pengjiantao/vscode-acp-chat/commit/0150413081ddcc66cc314d40079afc2ee3674c32))

## [0.12.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.11.1...v0.12.0) (2026-04-16)

### Features

- **webview:** add code highlighting support with highlight.js ([ddf0f14](https://github.com/pengjiantao/vscode-acp-chat/commit/ddf0f14a7b043dff5190205a0875ed9d12f62691))
- **webview:** add copy button to code blocks ([069f0ae](https://github.com/pengjiantao/vscode-acp-chat/commit/069f0aeaf740877f5bcc56f8eb57afff171b3509))

## [0.11.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.11.0...v0.11.1) (2026-04-13)

### Bug Fixes

- improve tooltip handling for detached elements ([c61abe6](https://github.com/pengjiantao/vscode-acp-chat/commit/c61abe632ef33c829788200545378e827159bce2))
- remove input max-height constraint and adjust overflow detection ([62612b6](https://github.com/pengjiantao/vscode-acp-chat/commit/62612b665925251496019452f4f25cf51c15e108))
- **webview:** check MutationObserver presence for test compatibility ([ec7fe6d](https://github.com/pengjiantao/vscode-acp-chat/commit/ec7fe6d10255ea9ada5c1359712f231b0f8063cf))

## [0.11.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.10.0...v0.11.0) (2026-04-11)

### Features

- add file path search with ranking and slash trigger fix ([6981f26](https://github.com/pengjiantao/vscode-acp-chat/commit/6981f26d7340f43be135793db021f39f4c5bdfc8))

## [0.10.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.9.2...v0.10.0) (2026-04-09)

### Features

- add custom VSCode-native tooltips in webview ([03a42cb](https://github.com/pengjiantao/vscode-acp-chat/commit/03a42cb51aecacbe92f4f77234255ad25741435f))
- add fade gradient effects to messages container ([33a043e](https://github.com/pengjiantao/vscode-acp-chat/commit/33a043e6546815f6346e005376c1c2b1f95c66fd))
- add fade gradient effects to messages container in test ([0ecf2ae](https://github.com/pengjiantao/vscode-acp-chat/commit/0ecf2ae88b828d934874548a53900583a68c9bb7))
- improve mention chip display and navigation ([6030397](https://github.com/pengjiantao/vscode-acp-chat/commit/6030397cde62994a79b527cb5805a33bb23f851d))

### Bug Fixes

- 修复 opencode 回显用户消息导致流提前结束的问题 ([a545906](https://github.com/pengjiantao/vscode-acp-chat/commit/a545906104ba10037b3a3a8042161900e97f8f1e))

## [0.9.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.9.0...v0.9.1) (2026-04-05)

### Bug Fixes

- 更新项目截图 ([b299f9d](https://github.com/pengjiantao/vscode-acp-chat/commit/b299f9dd6d4630078383580c23dbf7bca535dfa7))
