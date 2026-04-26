# Changelog

## [1.2.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.1.1...v1.2.0) (2026-04-26)


### Features

* **agents:** add project-specific agent skills ([e75f1e9](https://github.com/pengjiantao/vscode-acp-chat/commit/e75f1e91d88c3a8e1d869e0af86e974355ded337))
* **webview:** add message action buttons and improve turn separation ([d8a68df](https://github.com/pengjiantao/vscode-acp-chat/commit/d8a68df6994bc885ebb67f1e7b213fb7083e94b4))
* **webview:** add slash command chips for user messages ([8c0f138](https://github.com/pengjiantao/vscode-acp-chat/commit/8c0f138b83520a07c1e90c0c083eedeaf36bda30))


### Bug Fixes

* prevent dropdown and tooltip overflow at viewport edges ([9974516](https://github.com/pengjiantao/vscode-acp-chat/commit/997451635c8f6a0823c220257663ed6b24a7d555))
* update autocomplete to use global offsets and fix related bugs ([9107190](https://github.com/pengjiantao/vscode-acp-chat/commit/91071900b3b7ebd52cd8a1b21bf0c2bab928b12b))


### Performance Improvements

* **webview:** optimize autocomplete rendering and improve focus management ([03cf7e0](https://github.com/pengjiantao/vscode-acp-chat/commit/03cf7e05afff54bf2bafc06e7159fd471b8bf5fa))

## [1.1.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.1.0...v1.1.1) (2026-04-24)


### Bug Fixes

* **webview:** ensure diff line background covers full width when scrolling ([119caa4](https://github.com/pengjiantao/vscode-acp-chat/commit/119caa4d07023d7b2d7bc1d817ff00f3ec15a873))

## [1.1.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.0.1...v1.1.0) (2026-04-24)


### Features

* add custom agent configuration with override support ([e13ae3a](https://github.com/pengjiantao/vscode-acp-chat/commit/e13ae3a073ffd76f1472bd6e4f813db3ca87876c))
* add http/sse transport support for MCP server configuration ([7b5b2e6](https://github.com/pengjiantao/vscode-acp-chat/commit/7b5b2e6d8edaab1854e0a606d38e8b15c5519b73))
* add MCP client integration ([b5ddb2a](https://github.com/pengjiantao/vscode-acp-chat/commit/b5ddb2a8581febe4554634df140608191c1b48b4))
* add optional MCP server passthrough configuration ([866b1df](https://github.com/pengjiantao/vscode-acp-chat/commit/866b1dfbd94223a6f658fb4b62f6b542ec7f7cd4))
* update cursor agent command to cursor-agent ([a022576](https://github.com/pengjiantao/vscode-acp-chat/commit/a022576ea4006eca8f2309698a847f262e642df8))


### Bug Fixes

* update icon for ToolKind.other from gear to tools ([7bd0b98](https://github.com/pengjiantao/vscode-acp-chat/commit/7bd0b9839bf138b7a36dc844bab939551c235519))

## [1.0.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.0.0...v1.0.1) (2026-04-20)


### Bug Fixes

* resolve chat UI issues, optimize loading and add Cursor integration ([0150413](https://github.com/pengjiantao/vscode-acp-chat/commit/0150413081ddcc66cc314d40079afc2ee3674c32))

## [0.12.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.11.1...v0.12.0) (2026-04-16)


### Features

* **webview:** add code highlighting support with highlight.js ([ddf0f14](https://github.com/pengjiantao/vscode-acp-chat/commit/ddf0f14a7b043dff5190205a0875ed9d12f62691))
* **webview:** add copy button to code blocks ([069f0ae](https://github.com/pengjiantao/vscode-acp-chat/commit/069f0aeaf740877f5bcc56f8eb57afff171b3509))

## [0.11.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.11.0...v0.11.1) (2026-04-13)


### Bug Fixes

* improve tooltip handling for detached elements ([c61abe6](https://github.com/pengjiantao/vscode-acp-chat/commit/c61abe632ef33c829788200545378e827159bce2))
* remove input max-height constraint and adjust overflow detection ([62612b6](https://github.com/pengjiantao/vscode-acp-chat/commit/62612b665925251496019452f4f25cf51c15e108))
* **webview:** check MutationObserver presence for test compatibility ([ec7fe6d](https://github.com/pengjiantao/vscode-acp-chat/commit/ec7fe6d10255ea9ada5c1359712f231b0f8063cf))

## [0.11.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.10.0...v0.11.0) (2026-04-11)


### Features

* add file path search with ranking and slash trigger fix ([6981f26](https://github.com/pengjiantao/vscode-acp-chat/commit/6981f26d7340f43be135793db021f39f4c5bdfc8))

## [0.10.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.9.2...v0.10.0) (2026-04-09)


### Features

* add custom VSCode-native tooltips in webview ([03a42cb](https://github.com/pengjiantao/vscode-acp-chat/commit/03a42cb51aecacbe92f4f77234255ad25741435f))
* add fade gradient effects to messages container ([33a043e](https://github.com/pengjiantao/vscode-acp-chat/commit/33a043e6546815f6346e005376c1c2b1f95c66fd))
* add fade gradient effects to messages container in test ([0ecf2ae](https://github.com/pengjiantao/vscode-acp-chat/commit/0ecf2ae88b828d934874548a53900583a68c9bb7))
* improve mention chip display and navigation ([6030397](https://github.com/pengjiantao/vscode-acp-chat/commit/6030397cde62994a79b527cb5805a33bb23f851d))


### Bug Fixes

* 修复 opencode 回显用户消息导致流提前结束的问题 ([a545906](https://github.com/pengjiantao/vscode-acp-chat/commit/a545906104ba10037b3a3a8042161900e97f8f1e))

## [0.9.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v0.9.0...v0.9.1) (2026-04-05)


### Bug Fixes

* 更新项目截图 ([b299f9d](https://github.com/pengjiantao/vscode-acp-chat/commit/b299f9dd6d4630078383580c23dbf7bca535dfa7))
