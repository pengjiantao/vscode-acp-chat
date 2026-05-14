# Changelog

## [1.4.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.3.0...v1.4.0) (2026-05-14)


### Features

* add agent plan display UI ([#27](https://github.com/pengjiantao/vscode-acp-chat/issues/27)) ([b92618e](https://github.com/pengjiantao/vscode-acp-chat/commit/b92618ef874ae0b2fc6296a373a31785dedbe9e7))
* add agent plan display UI ([#34](https://github.com/pengjiantao/vscode-acp-chat/issues/34)) ([8e2fe65](https://github.com/pengjiantao/vscode-acp-chat/commit/8e2fe65eb991d133a7d59b452b378e99eeaef4fa))
* add collapsible plan header with toggle functionality ([5e3d4b3](https://github.com/pengjiantao/vscode-acp-chat/commit/5e3d4b30d707e97a30f961d620f9902359314349))
* add custom agent configuration with override support ([e13ae3a](https://github.com/pengjiantao/vscode-acp-chat/commit/e13ae3a073ffd76f1472bd6e4f813db3ca87876c))
* add custom VSCode-native tooltips in webview ([03a42cb](https://github.com/pengjiantao/vscode-acp-chat/commit/03a42cb51aecacbe92f4f77234255ad25741435f))
* add diff summary with review/accept/rollback support ([5cef8ca](https://github.com/pengjiantao/vscode-acp-chat/commit/5cef8ca234c1082eee3846c17b9625d6033c7114))
* add fade gradient effects to messages container ([33a043e](https://github.com/pengjiantao/vscode-acp-chat/commit/33a043e6546815f6346e005376c1c2b1f95c66fd))
* add fade gradient effects to messages container in test ([0ecf2ae](https://github.com/pengjiantao/vscode-acp-chat/commit/0ecf2ae88b828d934874548a53900583a68c9bb7))
* add file path search with ranking and slash trigger fix ([6981f26](https://github.com/pengjiantao/vscode-acp-chat/commit/6981f26d7340f43be135793db021f39f4c5bdfc8))
* add file watcher to diff-manager with proper dispose ([e6d710c](https://github.com/pengjiantao/vscode-acp-chat/commit/e6d710c1c4694fdcd5135ff1e6573c057aba9040))
* add folder type support to mention interfaces ([beddddd](https://github.com/pengjiantao/vscode-acp-chat/commit/beddddd1782cb929fc305931c361c7f2268b3832))
* add history session loading support (loadSession/listSessions) ([8a8ef44](https://github.com/pengjiantao/vscode-acp-chat/commit/8a8ef4476604f0fc3e11c0d03a2236bd964f30ad))
* add http/sse transport support for MCP server configuration ([7b5b2e6](https://github.com/pengjiantao/vscode-acp-chat/commit/7b5b2e6d8edaab1854e0a606d38e8b15c5519b73))
* add line numbers to diff view and show context instead of truncating ([155e4f5](https://github.com/pengjiantao/vscode-acp-chat/commit/155e4f5aa73fac83ae60ca46fc7f648b93864e86))
* add MCP client integration ([b5ddb2a](https://github.com/pengjiantao/vscode-acp-chat/commit/b5ddb2a8581febe4554634df140608191c1b48b4))
* add optional MCP server passthrough configuration ([866b1df](https://github.com/pengjiantao/vscode-acp-chat/commit/866b1dfbd94223a6f658fb4b62f6b542ec7f7cd4))
* add screenshot tests for ANSI output and plan display ([#31](https://github.com/pengjiantao/vscode-acp-chat/issues/31)) ([4bacf83](https://github.com/pengjiantao/vscode-acp-chat/commit/4bacf83492608a205e954194abdc95263701895d))
* add sendSelectionToChat command for editor and terminal selections ([7ae6432](https://github.com/pengjiantao/vscode-acp-chat/commit/7ae6432212bcc2e0e838c7e2e35d794b0477372c))
* add sendTerminalSelectionToChat command and refactor terminal selection handling ([c875eb9](https://github.com/pengjiantao/vscode-acp-chat/commit/c875eb96b65da13073b017113473faa8030398b9))
* add session update queue for ordered message processing ([8e0c050](https://github.com/pengjiantao/vscode-acp-chat/commit/8e0c0500bbb01279bfd0fc56a9a7b940fe1a53e4))
* add slash command autocomplete support ([#18](https://github.com/pengjiantao/vscode-acp-chat/issues/18)) ([62d9c41](https://github.com/pengjiantao/vscode-acp-chat/commit/62d9c414dba77a3215fbbaf02f800fdfcd1237ce))
* add starring functionality for model dropdown ([39789b7](https://github.com/pengjiantao/vscode-acp-chat/commit/39789b7ffb9f21ca2d0ea660d65a6b54910b19f8))
* Add terminal output embedding with ANSI colors ([#76](https://github.com/pengjiantao/vscode-acp-chat/issues/76)) ([f2ca25f](https://github.com/pengjiantao/vscode-acp-chat/commit/f2ca25fb162f438468ce3f8824a6b12897aa5222))
* add terminal output with ANSI color support ([#28](https://github.com/pengjiantao/vscode-acp-chat/issues/28)) ([72c0c78](https://github.com/pengjiantao/vscode-acp-chat/commit/72c0c786e1811fb30a45e4a43789723bc72d6276))
* add user message chunk handling for history session restoration ([77e1ce8](https://github.com/pengjiantao/vscode-acp-chat/commit/77e1ce82a2587bbb4254a1ebbecbc3b50d8f865b))
* **agents:** add project-specific agent skills ([e75f1e9](https://github.com/pengjiantao/vscode-acp-chat/commit/e75f1e91d88c3a8e1d869e0af86e974355ded337))
* **chat:** add permission request dialog UI and handling ([02af728](https://github.com/pengjiantao/vscode-acp-chat/commit/02af7286e1ee6dd047aced352493bdd8a8f2573f))
* **chat:** migrate preferences to agent-scoped storage and add starred models backend ([785766e](https://github.com/pengjiantao/vscode-acp-chat/commit/785766e090046e6c76e314181f9c2926db0591f4))
* display agent thought chunks ([#66](https://github.com/pengjiantao/vscode-acp-chat/issues/66)) ([6765218](https://github.com/pengjiantao/vscode-acp-chat/commit/676521871d2286af14ae64ce445a31084cbf9091))
* display tool kind icons ([#67](https://github.com/pengjiantao/vscode-acp-chat/issues/67)) ([b0e8411](https://github.com/pengjiantao/vscode-acp-chat/commit/b0e8411d3acc00e456aa37ba4b6b2a6e2e43e1ac))
* enhance command autocomplete with QuickPick-style UI ([dd0071a](https://github.com/pengjiantao/vscode-acp-chat/commit/dd0071a16bdc28d77751bd71aea0aca8e35e726c))
* enhance file search to include folders with inline path display ([ac3f42b](https://github.com/pengjiantao/vscode-acp-chat/commit/ac3f42bebd21451d30e23436c636cfafc02c9b91))
* enhance mention serialization with chat view integration ([b63eca6](https://github.com/pengjiantao/vscode-acp-chat/commit/b63eca6ce83b2ede44d475959cef97a38a8674ad))
* implement terminal integration and file system capabilities ([#64](https://github.com/pengjiantao/vscode-acp-chat/issues/64)) ([e84663e](https://github.com/pengjiantao/vscode-acp-chat/commit/e84663edd74ed572f2073a4b8381d1dfaa16b953))
* improve mention chip display and navigation ([6030397](https://github.com/pengjiantao/vscode-acp-chat/commit/6030397cde62994a79b527cb5805a33bb23f851d))
* improve tool call identifier extraction and kind icon handling ([98a8326](https://github.com/pengjiantao/vscode-acp-chat/commit/98a83267aeca45cad4cee79fa2a76f857a055886))
* **kiro-cli:** add Kiro CLI to supported agents ([#89](https://github.com/pengjiantao/vscode-acp-chat/issues/89)) ([3444585](https://github.com/pengjiantao/vscode-acp-chat/commit/344458528577dcb2caea1cdf0750d6fb4585162e))
* **permission:** add embedded permission dialog UI ([538990d](https://github.com/pengjiantao/vscode-acp-chat/commit/538990da0ebee8d7db4545174ac63ea5750231c2))
* split agent response messages when tools are executed ([#38](https://github.com/pengjiantao/vscode-acp-chat/issues/38)) ([f7d15f5](https://github.com/pengjiantao/vscode-acp-chat/commit/f7d15f59bb35547572ccf6abe2f0382a7ca1e6c5))
* testing infrastructure, UX improvements, and error handling ([#5](https://github.com/pengjiantao/vscode-acp-chat/issues/5)) ([e201ff1](https://github.com/pengjiantao/vscode-acp-chat/commit/e201ff159004d29fbe8014d4700c882ac24fb97a))
* **tool:** add duration display and details panel for tool calls ([1b78cd2](https://github.com/pengjiantao/vscode-acp-chat/commit/1b78cd2c252ab7ed9e2c116189becc6a114dca97))
* **ui:** add agent name to placeholder and update input styling ([adfca96](https://github.com/pengjiantao/vscode-acp-chat/commit/adfca96778c88bcac5572f76e2356ed67a5560cc))
* **ui:** make chat input hint visible and improve layout ([5ccdbe3](https://github.com/pengjiantao/vscode-acp-chat/commit/5ccdbe3b4c7059d813d401d9cc8d1c47c68308ac))
* update cursor agent command to cursor-agent ([a022576](https://github.com/pengjiantao/vscode-acp-chat/commit/a022576ea4006eca8f2309698a847f262e642df8))
* VS Code extension for Agent Client Protocol (ACP) ([101e564](https://github.com/pengjiantao/vscode-acp-chat/commit/101e56444cabc045217a8caab05c4767d6e300fc))
* **webview:** add code highlighting support with highlight.js ([ddf0f14](https://github.com/pengjiantao/vscode-acp-chat/commit/ddf0f14a7b043dff5190205a0875ed9d12f62691))
* **webview:** add copy button to code blocks ([069f0ae](https://github.com/pengjiantao/vscode-acp-chat/commit/069f0aeaf740877f5bcc56f8eb57afff171b3509))
* **webview:** add image attachments and file mention support ([483fa6b](https://github.com/pengjiantao/vscode-acp-chat/commit/483fa6b693da8a5da09feab6b89dae233779f38d))
* **webview:** add message action buttons and improve turn separation ([d8a68df](https://github.com/pengjiantao/vscode-acp-chat/commit/d8a68df6994bc885ebb67f1e7b213fb7083e94b4))
* **webview:** add slash command chips for user messages ([8c0f138](https://github.com/pengjiantao/vscode-acp-chat/commit/8c0f138b83520a07c1e90c0c083eedeaf36bda30))
* **webview:** add stop button and typing indicator ([886ece8](https://github.com/pengjiantao/vscode-acp-chat/commit/886ece8682a5843565452bce458e80de8194dc45))
* **webview:** display file diffs for tool call results ([#83](https://github.com/pengjiantao/vscode-acp-chat/issues/83)) ([3eea133](https://github.com/pengjiantao/vscode-acp-chat/commit/3eea13369641d9dcce71b3e56c652780464a6737))
* **webview:** enhance diff display algorithm and styling ([71f3f2e](https://github.com/pengjiantao/vscode-acp-chat/commit/71f3f2ec7a46948c73223cfff22e5d05287b9107))
* **webview:** persist tool kind and add fallback for toolCallComplete ([2eb04cb](https://github.com/pengjiantao/vscode-acp-chat/commit/2eb04cb6e9c9cf617d732691ef558b1a2d1fa55f))
* **webview:** redesign chat input area with styled dropdowns ([6b7be98](https://github.com/pengjiantao/vscode-acp-chat/commit/6b7be9857b21535c507fae1355197703be51b25c))
* **webview:** replace character icons with VSCode-styled SVG icons ([11e54b6](https://github.com/pengjiantao/vscode-acp-chat/commit/11e54b673c9b03e69e6a846ac072afc692a0d27d))
* **webview:** support mention chips in user messages ([5330be6](https://github.com/pengjiantao/vscode-acp-chat/commit/5330be6e151089e2d8c60a139ae2d999db4b0373))


### Bug Fixes

* add additional field name fallbacks for path and text extraction ([4b53d20](https://github.com/pengjiantao/vscode-acp-chat/commit/4b53d20635552963daa78d1ff525fa37730f560d))
* add scrollToBottom after message finalization and reduce button gap ([60873f0](https://github.com/pengjiantao/vscode-acp-chat/commit/60873f0563331349d00752730ac1e9a810db8ca1))
* adjust dropdown chevron icon size and alignment ([a02196c](https://github.com/pengjiantao/vscode-acp-chat/commit/a02196c48ca70c23bce7a65acd337ad0766e39a0))
* **agents:** expand PATH search to include global bin directories ([b677842](https://github.com/pengjiantao/vscode-acp-chat/commit/b6778429a844688b31079a81e548b17333445db2))
* **chat:** disable send button when input is empty ([2cd3604](https://github.com/pengjiantao/vscode-acp-chat/commit/2cd3604e736a8a22f659025343d17eeaa79c7db1))
* ensure tool rawInput is available for diff generation ([cfc1832](https://github.com/pengjiantao/vscode-acp-chat/commit/cfc1832c0f27537dcbe05b98fc92ad9728f89680))
* extract plain text on paste to prevent UI misalignment and XSS ([025c140](https://github.com/pengjiantao/vscode-acp-chat/commit/025c1402a3bb12e6afbd4de9a11f7872ec069f01))
* handle file not found error gracefully in chat view ([9dfbecc](https://github.com/pengjiantao/vscode-acp-chat/commit/9dfbecc9d287e93a567b7b4eccbabfaaea74a7b9))
* handle race conditions in tool call diff generation and support async session listeners ([fc9d6e1](https://github.com/pengjiantao/vscode-acp-chat/commit/fc9d6e19cebe194e5ce3e8407d2f80359debc2ba))
* improve mention chip styling and add folder support ([a0be1b8](https://github.com/pengjiantao/vscode-acp-chat/commit/a0be1b81dc2caefdb450a8693c1b6937b0cafa1d))
* improve tooltip handling for detached elements ([c61abe6](https://github.com/pengjiantao/vscode-acp-chat/commit/c61abe632ef33c829788200545378e827159bce2))
* persist model and mode selection across VSCode reloads ([#35](https://github.com/pengjiantao/vscode-acp-chat/issues/35)) ([16f4cd3](https://github.com/pengjiantao/vscode-acp-chat/commit/16f4cd3c830e517059112d2d4b397838a45ec81b))
* preserve rawInput for tool calls across message batches ([6be46d4](https://github.com/pengjiantao/vscode-acp-chat/commit/6be46d4c76f29ee1cf16bf5be080dbca91c362cd))
* prevent dropdown and tooltip overflow at viewport edges ([9974516](https://github.com/pengjiantao/vscode-acp-chat/commit/997451635c8f6a0823c220257663ed6b24a7d555))
* race condition in process spawn and auto-reconnect on agent change ([d4543c4](https://github.com/pengjiantao/vscode-acp-chat/commit/d4543c495bcef04888bb2fc4a06b14fdb77522ce))
* remove input max-height constraint and adjust overflow detection ([62612b6](https://github.com/pengjiantao/vscode-acp-chat/commit/62612b665925251496019452f4f25cf51c15e108))
* rename plan-progress to plan-counter and improve scroll behavior ([e9c8550](https://github.com/pengjiantao/vscode-acp-chat/commit/e9c8550583fb253992ce5564dff9d4fede6b6e48))
* rename publisher ([58053dc](https://github.com/pengjiantao/vscode-acp-chat/commit/58053dcde76a367d14052da30805f87050baa5cb))
* resolve chat UI issues, optimize loading and add Cursor integration ([0150413](https://github.com/pengjiantao/vscode-acp-chat/commit/0150413081ddcc66cc314d40079afc2ee3674c32))
* resolve logo displaying as gray square in VSCode sidebar ([#71](https://github.com/pengjiantao/vscode-acp-chat/issues/71)) ([c8b5a54](https://github.com/pengjiantao/vscode-acp-chat/commit/c8b5a54455db0c75d5c4483a55a58b334ed7cfea))
* tool execution block missing after permission request ([f067986](https://github.com/pengjiantao/vscode-acp-chat/commit/f067986fb78a783554e615b18a6096a75e54baed))
* **tool:** improve title display with caching and fallback logic ([54f8dd0](https://github.com/pengjiantao/vscode-acp-chat/commit/54f8dd0e5464a10cef7da62dae00e775bde444f3))
* track pending tool calls to prevent race conditions on cleanup ([55a5e29](https://github.com/pengjiantao/vscode-acp-chat/commit/55a5e2967bbe6be7d22dc813b2a77cec0a8d0ae0))
* **ui:** adjust input height after inserting mention chips ([867e9ed](https://github.com/pengjiantao/vscode-acp-chat/commit/867e9ed459aefd2cdc8c96fe8dbedda360d0fc40))
* **ui:** Pin plan view at top of chat ([#60](https://github.com/pengjiantao/vscode-acp-chat/issues/60)) ([#75](https://github.com/pengjiantao/vscode-acp-chat/issues/75)) ([6f629c3](https://github.com/pengjiantao/vscode-acp-chat/commit/6f629c3905789b705589013e254f9e0bbb1e8efa))
* update autocomplete to use global offsets and fix related bugs ([9107190](https://github.com/pengjiantao/vscode-acp-chat/commit/91071900b3b7ebd52cd8a1b21bf0c2bab928b12b))
* update extension IDs to vscode-acp-chat in viewsContainers and views ([8a6402a](https://github.com/pengjiantao/vscode-acp-chat/commit/8a6402aa00f75d35c1afe04cdcd2edd47dceb5be))
* update icon for ToolKind.other from gear to tools ([7bd0b98](https://github.com/pengjiantao/vscode-acp-chat/commit/7bd0b9839bf138b7a36dc844bab939551c235519))
* update qwen-code CLI command and ACP capabilities ([#73](https://github.com/pengjiantao/vscode-acp-chat/issues/73)) ([837f509](https://github.com/pengjiantao/vscode-acp-chat/commit/837f509e9cf957eb4d3936a9d212e527fb9c45cf))
* use correct image prompt format with mimeType instead of nested mediaType ([0fda5dc](https://github.com/pengjiantao/vscode-acp-chat/commit/0fda5dcfe56a469cb8a8ba15bcc900cbad234b1c))
* use xvfb-run for tests on Linux in release workflow ([#12](https://github.com/pengjiantao/vscode-acp-chat/issues/12)) ([a4f71f2](https://github.com/pengjiantao/vscode-acp-chat/commit/a4f71f2a900ae18075f6b133db7775d31ba9fa0f))
* **webview:** check MutationObserver presence for test compatibility ([ec7fe6d](https://github.com/pengjiantao/vscode-acp-chat/commit/ec7fe6d10255ea9ada5c1359712f231b0f8063cf))
* **webview:** clear image preview when hovered chip is removed ([26cc74c](https://github.com/pengjiantao/vscode-acp-chat/commit/26cc74c4374dfd79d35186b3f8955a694d742e46))
* **webview:** ensure diff line background covers full width when scrolling ([119caa4](https://github.com/pengjiantao/vscode-acp-chat/commit/119caa4d07023d7b2d7bc1d817ff00f3ec15a873))
* **webview:** fix double-click bug when switching between dropdowns ([b169448](https://github.com/pengjiantao/vscode-acp-chat/commit/b169448d2ec1796bb8c38ba1d013b874847c64bf))
* **webview:** fix icon clipping and alignment issues ([579efa5](https://github.com/pengjiantao/vscode-acp-chat/commit/579efa56be09f384f77f327648f638a6dd1a9c95))
* **webview:** improve input height calculation and scroll behavior ([ac2b23e](https://github.com/pengjiantao/vscode-acp-chat/commit/ac2b23ec0762fd20c3405e9b9a8735d9a3d3f0a9))
* **webview:** preserve scroll position when auto-resizing input textarea ([0033d1c](https://github.com/pengjiantao/vscode-acp-chat/commit/0033d1c663ae26bff51deebb1846ca90ab5cf8f7))
* **webview:** prevent chatCleared from clearing commands and dropdowns ([3b6e596](https://github.com/pengjiantao/vscode-acp-chat/commit/3b6e596fb1f600cc1598849a7c312ea3b3070292))
* **webview:** track auto-scroll state as class field ([f80da15](https://github.com/pengjiantao/vscode-acp-chat/commit/f80da15af366bc330ba54eb93000589c67ff8f54))
* 修复 opencode 回显用户消息导致流提前结束的问题 ([a545906](https://github.com/pengjiantao/vscode-acp-chat/commit/a545906104ba10037b3a3a8042161900e97f8f1e))
* 修复 Webview 中 IME 输入导致的重复字符问题 ([3406107](https://github.com/pengjiantao/vscode-acp-chat/commit/3406107442515cb1db2136902eb47ed595e17f11))
* 更新项目截图 ([b299f9d](https://github.com/pengjiantao/vscode-acp-chat/commit/b299f9dd6d4630078383580c23dbf7bca535dfa7))


### Performance Improvements

* **webview:** optimize autocomplete rendering and improve focus management ([03cf7e0](https://github.com/pengjiantao/vscode-acp-chat/commit/03cf7e05afff54bf2bafc06e7159fd471b8bf5fa))

## [1.4.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.3.0...v1.4.0) (2026-05-12)


### Features

* add agent plan display UI ([#27](https://github.com/pengjiantao/vscode-acp-chat/issues/27)) ([b92618e](https://github.com/pengjiantao/vscode-acp-chat/commit/b92618ef874ae0b2fc6296a373a31785dedbe9e7))
* add agent plan display UI ([#34](https://github.com/pengjiantao/vscode-acp-chat/issues/34)) ([8e2fe65](https://github.com/pengjiantao/vscode-acp-chat/commit/8e2fe65eb991d133a7d59b452b378e99eeaef4fa))
* add collapsible plan header with toggle functionality ([5e3d4b3](https://github.com/pengjiantao/vscode-acp-chat/commit/5e3d4b30d707e97a30f961d620f9902359314349))
* add custom agent configuration with override support ([e13ae3a](https://github.com/pengjiantao/vscode-acp-chat/commit/e13ae3a073ffd76f1472bd6e4f813db3ca87876c))
* add custom VSCode-native tooltips in webview ([03a42cb](https://github.com/pengjiantao/vscode-acp-chat/commit/03a42cb51aecacbe92f4f77234255ad25741435f))
* add diff summary with review/accept/rollback support ([5cef8ca](https://github.com/pengjiantao/vscode-acp-chat/commit/5cef8ca234c1082eee3846c17b9625d6033c7114))
* add fade gradient effects to messages container ([33a043e](https://github.com/pengjiantao/vscode-acp-chat/commit/33a043e6546815f6346e005376c1c2b1f95c66fd))
* add fade gradient effects to messages container in test ([0ecf2ae](https://github.com/pengjiantao/vscode-acp-chat/commit/0ecf2ae88b828d934874548a53900583a68c9bb7))
* add file path search with ranking and slash trigger fix ([6981f26](https://github.com/pengjiantao/vscode-acp-chat/commit/6981f26d7340f43be135793db021f39f4c5bdfc8))
* add file watcher to diff-manager with proper dispose ([e6d710c](https://github.com/pengjiantao/vscode-acp-chat/commit/e6d710c1c4694fdcd5135ff1e6573c057aba9040))
* add folder type support to mention interfaces ([beddddd](https://github.com/pengjiantao/vscode-acp-chat/commit/beddddd1782cb929fc305931c361c7f2268b3832))
* add history session loading support (loadSession/listSessions) ([8a8ef44](https://github.com/pengjiantao/vscode-acp-chat/commit/8a8ef4476604f0fc3e11c0d03a2236bd964f30ad))
* add http/sse transport support for MCP server configuration ([7b5b2e6](https://github.com/pengjiantao/vscode-acp-chat/commit/7b5b2e6d8edaab1854e0a606d38e8b15c5519b73))
* add line numbers to diff view and show context instead of truncating ([155e4f5](https://github.com/pengjiantao/vscode-acp-chat/commit/155e4f5aa73fac83ae60ca46fc7f648b93864e86))
* add MCP client integration ([b5ddb2a](https://github.com/pengjiantao/vscode-acp-chat/commit/b5ddb2a8581febe4554634df140608191c1b48b4))
* add optional MCP server passthrough configuration ([866b1df](https://github.com/pengjiantao/vscode-acp-chat/commit/866b1dfbd94223a6f658fb4b62f6b542ec7f7cd4))
* add screenshot tests for ANSI output and plan display ([#31](https://github.com/pengjiantao/vscode-acp-chat/issues/31)) ([4bacf83](https://github.com/pengjiantao/vscode-acp-chat/commit/4bacf83492608a205e954194abdc95263701895d))
* add sendSelectionToChat command for editor and terminal selections ([7ae6432](https://github.com/pengjiantao/vscode-acp-chat/commit/7ae6432212bcc2e0e838c7e2e35d794b0477372c))
* add sendTerminalSelectionToChat command and refactor terminal selection handling ([c875eb9](https://github.com/pengjiantao/vscode-acp-chat/commit/c875eb96b65da13073b017113473faa8030398b9))
* add session update queue for ordered message processing ([8e0c050](https://github.com/pengjiantao/vscode-acp-chat/commit/8e0c0500bbb01279bfd0fc56a9a7b940fe1a53e4))
* add slash command autocomplete support ([#18](https://github.com/pengjiantao/vscode-acp-chat/issues/18)) ([62d9c41](https://github.com/pengjiantao/vscode-acp-chat/commit/62d9c414dba77a3215fbbaf02f800fdfcd1237ce))
* add starring functionality for model dropdown ([39789b7](https://github.com/pengjiantao/vscode-acp-chat/commit/39789b7ffb9f21ca2d0ea660d65a6b54910b19f8))
* Add terminal output embedding with ANSI colors ([#76](https://github.com/pengjiantao/vscode-acp-chat/issues/76)) ([f2ca25f](https://github.com/pengjiantao/vscode-acp-chat/commit/f2ca25fb162f438468ce3f8824a6b12897aa5222))
* add terminal output with ANSI color support ([#28](https://github.com/pengjiantao/vscode-acp-chat/issues/28)) ([72c0c78](https://github.com/pengjiantao/vscode-acp-chat/commit/72c0c786e1811fb30a45e4a43789723bc72d6276))
* add user message chunk handling for history session restoration ([77e1ce8](https://github.com/pengjiantao/vscode-acp-chat/commit/77e1ce82a2587bbb4254a1ebbecbc3b50d8f865b))
* **agents:** add project-specific agent skills ([e75f1e9](https://github.com/pengjiantao/vscode-acp-chat/commit/e75f1e91d88c3a8e1d869e0af86e974355ded337))
* **chat:** add permission request dialog UI and handling ([02af728](https://github.com/pengjiantao/vscode-acp-chat/commit/02af7286e1ee6dd047aced352493bdd8a8f2573f))
* **chat:** migrate preferences to agent-scoped storage and add starred models backend ([785766e](https://github.com/pengjiantao/vscode-acp-chat/commit/785766e090046e6c76e314181f9c2926db0591f4))
* display agent thought chunks ([#66](https://github.com/pengjiantao/vscode-acp-chat/issues/66)) ([6765218](https://github.com/pengjiantao/vscode-acp-chat/commit/676521871d2286af14ae64ce445a31084cbf9091))
* display tool kind icons ([#67](https://github.com/pengjiantao/vscode-acp-chat/issues/67)) ([b0e8411](https://github.com/pengjiantao/vscode-acp-chat/commit/b0e8411d3acc00e456aa37ba4b6b2a6e2e43e1ac))
* enhance command autocomplete with QuickPick-style UI ([dd0071a](https://github.com/pengjiantao/vscode-acp-chat/commit/dd0071a16bdc28d77751bd71aea0aca8e35e726c))
* enhance file search to include folders with inline path display ([ac3f42b](https://github.com/pengjiantao/vscode-acp-chat/commit/ac3f42bebd21451d30e23436c636cfafc02c9b91))
* enhance mention serialization with chat view integration ([b63eca6](https://github.com/pengjiantao/vscode-acp-chat/commit/b63eca6ce83b2ede44d475959cef97a38a8674ad))
* implement terminal integration and file system capabilities ([#64](https://github.com/pengjiantao/vscode-acp-chat/issues/64)) ([e84663e](https://github.com/pengjiantao/vscode-acp-chat/commit/e84663edd74ed572f2073a4b8381d1dfaa16b953))
* improve mention chip display and navigation ([6030397](https://github.com/pengjiantao/vscode-acp-chat/commit/6030397cde62994a79b527cb5805a33bb23f851d))
* improve tool call identifier extraction and kind icon handling ([98a8326](https://github.com/pengjiantao/vscode-acp-chat/commit/98a83267aeca45cad4cee79fa2a76f857a055886))
* **kiro-cli:** add Kiro CLI to supported agents ([#89](https://github.com/pengjiantao/vscode-acp-chat/issues/89)) ([3444585](https://github.com/pengjiantao/vscode-acp-chat/commit/344458528577dcb2caea1cdf0750d6fb4585162e))
* **permission:** add embedded permission dialog UI ([538990d](https://github.com/pengjiantao/vscode-acp-chat/commit/538990da0ebee8d7db4545174ac63ea5750231c2))
* split agent response messages when tools are executed ([#38](https://github.com/pengjiantao/vscode-acp-chat/issues/38)) ([f7d15f5](https://github.com/pengjiantao/vscode-acp-chat/commit/f7d15f59bb35547572ccf6abe2f0382a7ca1e6c5))
* testing infrastructure, UX improvements, and error handling ([#5](https://github.com/pengjiantao/vscode-acp-chat/issues/5)) ([e201ff1](https://github.com/pengjiantao/vscode-acp-chat/commit/e201ff159004d29fbe8014d4700c882ac24fb97a))
* **tool:** add duration display and details panel for tool calls ([1b78cd2](https://github.com/pengjiantao/vscode-acp-chat/commit/1b78cd2c252ab7ed9e2c116189becc6a114dca97))
* **ui:** add agent name to placeholder and update input styling ([adfca96](https://github.com/pengjiantao/vscode-acp-chat/commit/adfca96778c88bcac5572f76e2356ed67a5560cc))
* **ui:** make chat input hint visible and improve layout ([5ccdbe3](https://github.com/pengjiantao/vscode-acp-chat/commit/5ccdbe3b4c7059d813d401d9cc8d1c47c68308ac))
* update cursor agent command to cursor-agent ([a022576](https://github.com/pengjiantao/vscode-acp-chat/commit/a022576ea4006eca8f2309698a847f262e642df8))
* VS Code extension for Agent Client Protocol (ACP) ([101e564](https://github.com/pengjiantao/vscode-acp-chat/commit/101e56444cabc045217a8caab05c4767d6e300fc))
* **webview:** add code highlighting support with highlight.js ([ddf0f14](https://github.com/pengjiantao/vscode-acp-chat/commit/ddf0f14a7b043dff5190205a0875ed9d12f62691))
* **webview:** add copy button to code blocks ([069f0ae](https://github.com/pengjiantao/vscode-acp-chat/commit/069f0aeaf740877f5bcc56f8eb57afff171b3509))
* **webview:** add image attachments and file mention support ([483fa6b](https://github.com/pengjiantao/vscode-acp-chat/commit/483fa6b693da8a5da09feab6b89dae233779f38d))
* **webview:** add message action buttons and improve turn separation ([d8a68df](https://github.com/pengjiantao/vscode-acp-chat/commit/d8a68df6994bc885ebb67f1e7b213fb7083e94b4))
* **webview:** add slash command chips for user messages ([8c0f138](https://github.com/pengjiantao/vscode-acp-chat/commit/8c0f138b83520a07c1e90c0c083eedeaf36bda30))
* **webview:** add stop button and typing indicator ([886ece8](https://github.com/pengjiantao/vscode-acp-chat/commit/886ece8682a5843565452bce458e80de8194dc45))
* **webview:** display file diffs for tool call results ([#83](https://github.com/pengjiantao/vscode-acp-chat/issues/83)) ([3eea133](https://github.com/pengjiantao/vscode-acp-chat/commit/3eea13369641d9dcce71b3e56c652780464a6737))
* **webview:** enhance diff display algorithm and styling ([71f3f2e](https://github.com/pengjiantao/vscode-acp-chat/commit/71f3f2ec7a46948c73223cfff22e5d05287b9107))
* **webview:** persist tool kind and add fallback for toolCallComplete ([2eb04cb](https://github.com/pengjiantao/vscode-acp-chat/commit/2eb04cb6e9c9cf617d732691ef558b1a2d1fa55f))
* **webview:** redesign chat input area with styled dropdowns ([6b7be98](https://github.com/pengjiantao/vscode-acp-chat/commit/6b7be9857b21535c507fae1355197703be51b25c))
* **webview:** replace character icons with VSCode-styled SVG icons ([11e54b6](https://github.com/pengjiantao/vscode-acp-chat/commit/11e54b673c9b03e69e6a846ac072afc692a0d27d))
* **webview:** support mention chips in user messages ([5330be6](https://github.com/pengjiantao/vscode-acp-chat/commit/5330be6e151089e2d8c60a139ae2d999db4b0373))


### Bug Fixes

* add additional field name fallbacks for path and text extraction ([4b53d20](https://github.com/pengjiantao/vscode-acp-chat/commit/4b53d20635552963daa78d1ff525fa37730f560d))
* adjust dropdown chevron icon size and alignment ([a02196c](https://github.com/pengjiantao/vscode-acp-chat/commit/a02196c48ca70c23bce7a65acd337ad0766e39a0))
* **agents:** expand PATH search to include global bin directories ([b677842](https://github.com/pengjiantao/vscode-acp-chat/commit/b6778429a844688b31079a81e548b17333445db2))
* **chat:** disable send button when input is empty ([2cd3604](https://github.com/pengjiantao/vscode-acp-chat/commit/2cd3604e736a8a22f659025343d17eeaa79c7db1))
* ensure tool rawInput is available for diff generation ([cfc1832](https://github.com/pengjiantao/vscode-acp-chat/commit/cfc1832c0f27537dcbe05b98fc92ad9728f89680))
* extract plain text on paste to prevent UI misalignment and XSS ([025c140](https://github.com/pengjiantao/vscode-acp-chat/commit/025c1402a3bb12e6afbd4de9a11f7872ec069f01))
* handle file not found error gracefully in chat view ([9dfbecc](https://github.com/pengjiantao/vscode-acp-chat/commit/9dfbecc9d287e93a567b7b4eccbabfaaea74a7b9))
* handle race conditions in tool call diff generation and support async session listeners ([fc9d6e1](https://github.com/pengjiantao/vscode-acp-chat/commit/fc9d6e19cebe194e5ce3e8407d2f80359debc2ba))
* improve mention chip styling and add folder support ([a0be1b8](https://github.com/pengjiantao/vscode-acp-chat/commit/a0be1b81dc2caefdb450a8693c1b6937b0cafa1d))
* improve tooltip handling for detached elements ([c61abe6](https://github.com/pengjiantao/vscode-acp-chat/commit/c61abe632ef33c829788200545378e827159bce2))
* persist model and mode selection across VSCode reloads ([#35](https://github.com/pengjiantao/vscode-acp-chat/issues/35)) ([16f4cd3](https://github.com/pengjiantao/vscode-acp-chat/commit/16f4cd3c830e517059112d2d4b397838a45ec81b))
* preserve rawInput for tool calls across message batches ([6be46d4](https://github.com/pengjiantao/vscode-acp-chat/commit/6be46d4c76f29ee1cf16bf5be080dbca91c362cd))
* prevent dropdown and tooltip overflow at viewport edges ([9974516](https://github.com/pengjiantao/vscode-acp-chat/commit/997451635c8f6a0823c220257663ed6b24a7d555))
* race condition in process spawn and auto-reconnect on agent change ([d4543c4](https://github.com/pengjiantao/vscode-acp-chat/commit/d4543c495bcef04888bb2fc4a06b14fdb77522ce))
* remove input max-height constraint and adjust overflow detection ([62612b6](https://github.com/pengjiantao/vscode-acp-chat/commit/62612b665925251496019452f4f25cf51c15e108))
* rename plan-progress to plan-counter and improve scroll behavior ([e9c8550](https://github.com/pengjiantao/vscode-acp-chat/commit/e9c8550583fb253992ce5564dff9d4fede6b6e48))
* rename publisher ([58053dc](https://github.com/pengjiantao/vscode-acp-chat/commit/58053dcde76a367d14052da30805f87050baa5cb))
* resolve chat UI issues, optimize loading and add Cursor integration ([0150413](https://github.com/pengjiantao/vscode-acp-chat/commit/0150413081ddcc66cc314d40079afc2ee3674c32))
* resolve logo displaying as gray square in VSCode sidebar ([#71](https://github.com/pengjiantao/vscode-acp-chat/issues/71)) ([c8b5a54](https://github.com/pengjiantao/vscode-acp-chat/commit/c8b5a54455db0c75d5c4483a55a58b334ed7cfea))
* tool execution block missing after permission request ([f067986](https://github.com/pengjiantao/vscode-acp-chat/commit/f067986fb78a783554e615b18a6096a75e54baed))
* **tool:** improve title display with caching and fallback logic ([54f8dd0](https://github.com/pengjiantao/vscode-acp-chat/commit/54f8dd0e5464a10cef7da62dae00e775bde444f3))
* track pending tool calls to prevent race conditions on cleanup ([55a5e29](https://github.com/pengjiantao/vscode-acp-chat/commit/55a5e2967bbe6be7d22dc813b2a77cec0a8d0ae0))
* **ui:** adjust input height after inserting mention chips ([867e9ed](https://github.com/pengjiantao/vscode-acp-chat/commit/867e9ed459aefd2cdc8c96fe8dbedda360d0fc40))
* **ui:** Pin plan view at top of chat ([#60](https://github.com/pengjiantao/vscode-acp-chat/issues/60)) ([#75](https://github.com/pengjiantao/vscode-acp-chat/issues/75)) ([6f629c3](https://github.com/pengjiantao/vscode-acp-chat/commit/6f629c3905789b705589013e254f9e0bbb1e8efa))
* update autocomplete to use global offsets and fix related bugs ([9107190](https://github.com/pengjiantao/vscode-acp-chat/commit/91071900b3b7ebd52cd8a1b21bf0c2bab928b12b))
* update extension IDs to vscode-acp-chat in viewsContainers and views ([8a6402a](https://github.com/pengjiantao/vscode-acp-chat/commit/8a6402aa00f75d35c1afe04cdcd2edd47dceb5be))
* update icon for ToolKind.other from gear to tools ([7bd0b98](https://github.com/pengjiantao/vscode-acp-chat/commit/7bd0b9839bf138b7a36dc844bab939551c235519))
* update qwen-code CLI command and ACP capabilities ([#73](https://github.com/pengjiantao/vscode-acp-chat/issues/73)) ([837f509](https://github.com/pengjiantao/vscode-acp-chat/commit/837f509e9cf957eb4d3936a9d212e527fb9c45cf))
* use correct image prompt format with mimeType instead of nested mediaType ([0fda5dc](https://github.com/pengjiantao/vscode-acp-chat/commit/0fda5dcfe56a469cb8a8ba15bcc900cbad234b1c))
* use xvfb-run for tests on Linux in release workflow ([#12](https://github.com/pengjiantao/vscode-acp-chat/issues/12)) ([a4f71f2](https://github.com/pengjiantao/vscode-acp-chat/commit/a4f71f2a900ae18075f6b133db7775d31ba9fa0f))
* **webview:** check MutationObserver presence for test compatibility ([ec7fe6d](https://github.com/pengjiantao/vscode-acp-chat/commit/ec7fe6d10255ea9ada5c1359712f231b0f8063cf))
* **webview:** clear image preview when hovered chip is removed ([26cc74c](https://github.com/pengjiantao/vscode-acp-chat/commit/26cc74c4374dfd79d35186b3f8955a694d742e46))
* **webview:** ensure diff line background covers full width when scrolling ([119caa4](https://github.com/pengjiantao/vscode-acp-chat/commit/119caa4d07023d7b2d7bc1d817ff00f3ec15a873))
* **webview:** fix double-click bug when switching between dropdowns ([b169448](https://github.com/pengjiantao/vscode-acp-chat/commit/b169448d2ec1796bb8c38ba1d013b874847c64bf))
* **webview:** fix icon clipping and alignment issues ([579efa5](https://github.com/pengjiantao/vscode-acp-chat/commit/579efa56be09f384f77f327648f638a6dd1a9c95))
* **webview:** improve input height calculation and scroll behavior ([ac2b23e](https://github.com/pengjiantao/vscode-acp-chat/commit/ac2b23ec0762fd20c3405e9b9a8735d9a3d3f0a9))
* **webview:** preserve scroll position when auto-resizing input textarea ([0033d1c](https://github.com/pengjiantao/vscode-acp-chat/commit/0033d1c663ae26bff51deebb1846ca90ab5cf8f7))
* **webview:** prevent chatCleared from clearing commands and dropdowns ([3b6e596](https://github.com/pengjiantao/vscode-acp-chat/commit/3b6e596fb1f600cc1598849a7c312ea3b3070292))
* **webview:** track auto-scroll state as class field ([f80da15](https://github.com/pengjiantao/vscode-acp-chat/commit/f80da15af366bc330ba54eb93000589c67ff8f54))
* 修复 opencode 回显用户消息导致流提前结束的问题 ([a545906](https://github.com/pengjiantao/vscode-acp-chat/commit/a545906104ba10037b3a3a8042161900e97f8f1e))
* 修复 Webview 中 IME 输入导致的重复字符问题 ([3406107](https://github.com/pengjiantao/vscode-acp-chat/commit/3406107442515cb1db2136902eb47ed595e17f11))
* 更新项目截图 ([b299f9d](https://github.com/pengjiantao/vscode-acp-chat/commit/b299f9dd6d4630078383580c23dbf7bca535dfa7))


### Performance Improvements

* **webview:** optimize autocomplete rendering and improve focus management ([03cf7e0](https://github.com/pengjiantao/vscode-acp-chat/commit/03cf7e05afff54bf2bafc06e7159fd471b8bf5fa))

## [1.3.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.2.0...v1.3.0) (2026-05-12)


### Features

* **chat:** migrate preferences to agent-scoped storage and add starred models backend ([785766e](https://github.com/pengjiantao/vscode-acp-chat/commit/785766e090046e6c76e314181f9c2926db0591f4))


### Bug Fixes

* **webview:** preserve scroll position when auto-resizing input textarea ([0033d1c](https://github.com/pengjiantao/vscode-acp-chat/commit/0033d1c663ae26bff51deebb1846ca90ab5cf8f7))
* **webview:** track auto-scroll state as class field ([f80da15](https://github.com/pengjiantao/vscode-acp-chat/commit/f80da15af366bc330ba54eb93000589c67ff8f54))
* 修复 Webview 中 IME 输入导致的重复字符问题 ([3406107](https://github.com/pengjiantao/vscode-acp-chat/commit/3406107442515cb1db2136902eb47ed595e17f11))

## [1.3.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.2.0...v1.3.0) (2026-04-30)


### Features

* **chat:** migrate preferences to agent-scoped storage and add starred models backend ([785766e](https://github.com/pengjiantao/vscode-acp-chat/commit/785766e090046e6c76e314181f9c2926db0591f4))

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
