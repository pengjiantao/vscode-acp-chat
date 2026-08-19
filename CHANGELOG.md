# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [2.1.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v2.1.0...v2.1.1) (2026-08-19)

### Bug Fixes

- **acp:** require sessionId in getSessionMetadata and restore preferences for all sessions ([422fda3](https://github.com/pengjiantao/vscode-acp-chat/commit/422fda3c0006e0f231ff75ab28d857ecee9b1392))
- **load-history:** pre-select active session in history quick pick ([f3c6ee0](https://github.com/pengjiantao/vscode-acp-chat/commit/f3c6ee0f8f7d447af854cd1c3cc63e68a0d8c51d))
- **quick-pick:** move agent name before session title in history and open sessions menus ([21ace69](https://github.com/pengjiantao/vscode-acp-chat/commit/21ace69ed0e31d3d83110d3167b1065821ea174b))
- **quick-pick:** pre-select active tab's agent in new session picker ([2df8d85](https://github.com/pengjiantao/vscode-acp-chat/commit/2df8d85a49416edfb340dc340c3421936cad342f))
- **search:** respect .gitignore rules for dot-prefixed directories ([91b0ce4](https://github.com/pengjiantao/vscode-acp-chat/commit/91b0ce4295dc5e8798be6c52c4c64a312578907b))

## [2.1.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v2.0.0...v2.1.0) (2026-08-18)

### Features

- **chat:** auto-create new session after closing the last tab ([ad2b3b2](https://github.com/pengjiantao/vscode-acp-chat/commit/ad2b3b2256d77215db7f629b7861ef03f517a3ef))
- **chat:** support immediate loading feedback for sessions ([a220afc](https://github.com/pengjiantao/vscode-acp-chat/commit/a220afcf278c55b85b5eeb064be3701a4e460f26))
- **chat:** use first user message as session tab title fallback ([115052e](https://github.com/pengjiantao/vscode-acp-chat/commit/115052e24eed90607d779c70be5b5b9b86a0db63))
- **tab-bar:** place generating spinner to the left of session title ([b3850eb](https://github.com/pengjiantao/vscode-acp-chat/commit/b3850eb9a46d6c61a356ba2aaf15dd519171c0fd))

### Bug Fixes

- **tab-bar:** add top border separator to session tabs ([2f66b83](https://github.com/pengjiantao/vscode-acp-chat/commit/2f66b83c0e15f5c8a08ce62b59f46eb3ca0090d0))

## [2.0.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.22.0...v2.0.0) (2026-08-17)

### Features

- support multi-agent sessions with AgentPool and TabBar ([9022dcf](https://github.com/pengjiantao/vscode-acp-chat/commit/9022dcf9c8d759d3ec1806e84ab04ab876883339))

### Bug Fixes

- **webview:** shrink table columns to fit narrow webview ([35fb1be](https://github.com/pengjiantao/vscode-acp-chat/commit/35fb1be96cf927383752c8688c450c0caaa4256a))

## [1.22.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.21.0...v1.22.0) (2026-08-12)

### Features

- **acp:** upgrade sdk to 1.3.0 and implement elicitation ([d22360f](https://github.com/pengjiantao/vscode-acp-chat/commit/d22360fcd166c16d23c8fc798f8cf04b7a693c32))
- **webview:** refactor elicitation single choice to radio cards and compact UI ([3e5a1c4](https://github.com/pengjiantao/vscode-acp-chat/commit/3e5a1c4fc9786cc7b3f8e3814838c0286109adc9))

## [1.21.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.20.1...v1.21.0) (2026-08-08)

### Features

- **acp:** add useAgentSessionList setting to control session list source ([46d2da3](https://github.com/pengjiantao/vscode-acp-chat/commit/46d2da3c0793d95819d137b8216d52c15fc98655))
- **acp:** close previous sessions before session switches ([f63e6a1](https://github.com/pengjiantao/vscode-acp-chat/commit/f63e6a1f3d9de6499b56be514efd5e7c6187a724))
- **chat:** auto-approve permission requests for configured tool kinds ([7544851](https://github.com/pengjiantao/vscode-acp-chat/commit/7544851fb539fa65f3eee2a247917abbc121fa4d))
- **webview:** replace auto action buttons with double-click block focus ([ea8be7a](https://github.com/pengjiantao/vscode-acp-chat/commit/ea8be7a40c04b25c01185524fb407371eb4ee9f6))

### Bug Fixes

- **acp:** trust agent cwd filter in session list instead of re-filtering ([ac24ba4](https://github.com/pengjiantao/vscode-acp-chat/commit/ac24ba4e1c895a5e5ec2fb61ecba624e51942663))
- **chat:** clean up pending permission requests on session switches ([5300fa9](https://github.com/pengjiantao/vscode-acp-chat/commit/5300fa9cf1821c343449d16084487ba04fba436f))
- **webview:** render interleaved ACP message streams by messageId ([4645fbb](https://github.com/pengjiantao/vscode-acp-chat/commit/4645fbb691dbda87cb6af4610a72ccafb45a8b55))

### Code Refactoring

- **webview:** extract scroll-fade widget for transcript/thought scrolling ([aeffad5](https://github.com/pengjiantao/vscode-acp-chat/commit/aeffad5e314e7ed1839e5d771f9a13e1b451fff5))

### [1.20.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.20.0...v1.20.1) (2026-07-29)

### Bug Fixes

- **acp:** use cross-spawn for agent process to fix Windows .cmd handling ([da23f0d](https://github.com/pengjiantao/vscode-acp-chat/commit/da23f0dbc62e2118fb17819724a4d23d9d68e5ef))

## [1.20.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.19.0...v1.20.0) (2026-07-27)

### Features

- **webview:** add dropdown option descriptions & optimize tooltip display ([b8a47ef](https://github.com/pengjiantao/vscode-acp-chat/commit/b8a47ef279dcfd1b8c25a6e42e5dc68d068ce51c))

### Bug Fixes

- **webview:** elevate chat input z-index permanently to prevent border clipping in running state ([e292d73](https://github.com/pengjiantao/vscode-acp-chat/commit/e292d736b460a91154d7cf0d06a70485f01118c5))

## [1.19.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.18.7...v1.19.0) (2026-07-24)

### Features

- auto-create missing parent directories on writeTextFile ([e42d5a0](https://github.com/pengjiantao/vscode-acp-chat/commit/e42d5a0b90d739605f504949740a10fe20c4ff93))
- **webview:** add tooltips for markdown file and hyperlink references ([7e6127b](https://github.com/pengjiantao/vscode-acp-chat/commit/7e6127b42dc6ef1fc21c078cc7267c7a0a9bbd95))

### Bug Fixes

- **acp:** prevent npx hangs and clean up process trees ([abdbdea](https://github.com/pengjiantao/vscode-acp-chat/commit/abdbdeaf104f793140775f1543ddac8e27052d80))
- **extension:** pre-select current agent in QuickPick menu ([af03aea](https://github.com/pengjiantao/vscode-acp-chat/commit/af03aeac828b7c71e972f93276aee88be6d00de6))
- include hidden files in autocomplete file search and always exclude .git ([e6f14e9](https://github.com/pengjiantao/vscode-acp-chat/commit/e6f14e94ebb78d7fc1e4f0d45fd06972e4914943))
- **ui:** adapt welcome logo color to VSCode light and dark themes via CSS mask ([68b33b4](https://github.com/pengjiantao/vscode-acp-chat/commit/68b33b42c651f2e941b437aa7cc6f871e53d7596))
- **webview:** elevate chat input z-index on focus to prevent top border clipping ([4168d4b](https://github.com/pengjiantao/vscode-acp-chat/commit/4168d4b74ba8e7e16b2493f713b2d663f98215ea))
- **webview:** stabilize tooltip placement ([ac17a86](https://github.com/pengjiantao/vscode-acp-chat/commit/ac17a86174e08aa1ad919c6e4c805e29e4479f48))

### [1.18.7](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.18.6...v1.18.7) (2026-07-09)

### Bug Fixes

- select current session in Load History QuickPick ([bfdfe03](https://github.com/pengjiantao/vscode-acp-chat/commit/bfdfe035525ada74998196d552c8808af6bdcee6))

### [1.18.6](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.18.5...v1.18.6) (2026-07-09)

### Bug Fixes

- add zod as explicit dependency to fix npm ci peer dep resolution ([245c7b8](https://github.com/pengjiantao/vscode-acp-chat/commit/245c7b81ff20f0d8975f8dedf0da71b230a16d7c))

### [1.18.5](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.18.4...v1.18.5) (2026-07-08)

### Bug Fixes

- **agents:** add -y flag to npx to skip interactive install prompt ([a356094](https://github.com/pengjiantao/vscode-acp-chat/commit/a35609462a96a27bb45c0c76acc635fd37c97b2f))
- replace autocomplete query when inserting chip ([37fef01](https://github.com/pengjiantao/vscode-acp-chat/commit/37fef0192afeda5681409d1b21ad0e2ea9898e1a))

### Code Refactoring

- remove unused getElements from production code ([9bcace4](https://github.com/pengjiantao/vscode-acp-chat/commit/9bcace442aa5dfd7f69a556d032ceb1e153238b1))
- remove utility methods from WebviewContext, use direct imports ([4b79ff2](https://github.com/pengjiantao/vscode-acp-chat/commit/4b79ff29da5cb1951244c957d0892003a9cf6898))
- simplify newChat/clearChat by removing unnecessary message round-trip ([227bcc1](https://github.com/pengjiantao/vscode-acp-chat/commit/227bcc1dd39f297b232a92b9e9004b5f25a55485))
- **webview:** decompose WebviewController into component classes ([7f8af89](https://github.com/pengjiantao/vscode-acp-chat/commit/7f8af8949196fa53e24c4ae25fbe7f4e6892ac50))
- **webview:** introduce typed EventBus for intra-component communication ([a399583](https://github.com/pengjiantao/vscode-acp-chat/commit/a3995831143a34f27a3c24be1221cc9c18e6225e))
- **webview:** introduce WebviewContext, MessageHandler registration, and block widget hierarchy ([802ac59](https://github.com/pengjiantao/vscode-acp-chat/commit/802ac59c5d9487478561513b6cc53592ac6022f8))
- **webview:** move event wiring to components and eliminate duplicate initialization ([7aa4330](https://github.com/pengjiantao/vscode-acp-chat/commit/7aa43302a184a9d123accc5da8f82c45a63b8a5f))
- **webview:** move state persistence into owning components ([c726de8](https://github.com/pengjiantao/vscode-acp-chat/commit/c726de8a5955d222e41003e23cdb97d364b7cbd1))

### [1.18.4](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.18.3...v1.18.4) (2026-07-07)

### Bug Fixes

- **webview:** respect user scroll intent ([727df07](https://github.com/pengjiantao/vscode-acp-chat/commit/727df0757aa1d9602211cf363d738df0cc96b874))

### Code Refactoring

- **webview:** extract PermissionDialog, DiffSummary, PlanView widgets from main.ts ([94d0e57](https://github.com/pengjiantao/vscode-acp-chat/commit/94d0e57733f3bb1c7e9b78ff34f08ce8ca41f4fb))
- **webview:** extract types and first-priority widgets from main.ts ([52f5b3c](https://github.com/pengjiantao/vscode-acp-chat/commit/52f5b3c64c465e5facc6bc98924a89aff1e9d497))

### [1.18.3](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.18.2...v1.18.3) (2026-07-05)

### Bug Fixes

- unify thinking and edit tool icon colors with other tools ([de818e3](https://github.com/pengjiantao/vscode-acp-chat/commit/de818e3da71acd6a19df643dd63261f772899d0b))

### Code Refactoring

- replace inline highlight.js theme with theme-aware CSS variables ([b18b50a](https://github.com/pengjiantao/vscode-acp-chat/commit/b18b50a2c212797926d86e71f8e217c63c9a8463))

### [1.18.2](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.18.1...v1.18.2) (2026-07-05)

### Bug Fixes

- terminate terminal process trees ([c46dba9](https://github.com/pengjiantao/vscode-acp-chat/commit/c46dba906cebf4b829b0e279c96c3194a046c801))

### [1.18.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.18.0...v1.18.1) (2026-07-05)

## [1.18.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.17.0...v1.18.0) (2026-07-05)

### Features

- replace codicon file icons with Material Design icons ([df9bece](https://github.com/pengjiantao/vscode-acp-chat/commit/df9becec43695ca47e69642ea0a4e0ac49a8a10f))
- show red cross icon on failed tool summary ([679ef8e](https://github.com/pengjiantao/vscode-acp-chat/commit/679ef8eb761e296d1544ad39ff7df0f7e7dd81dd))

### Bug Fixes

- align input chips with text ([4474c21](https://github.com/pengjiantao/vscode-acp-chat/commit/4474c215e13a5f68180e9094e98e2846f742ec2b))

### Code Refactoring

- **tool-details:** remove Type/Path/Intent fields, restyle labels ([40a694f](https://github.com/pengjiantao/vscode-acp-chat/commit/40a694f8e5628ce67003e17ecb14d5f37c7afcb8))

## [1.17.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.16.0...v1.17.0) (2026-07-04)

### Features

- **session:** add persistence controls and automatic cleanup settings ([5ffd23c](https://github.com/pengjiantao/vscode-acp-chat/commit/5ffd23cc7f4fdf7b03449f1f4a649d742b2321df))

## [1.16.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.15.1...v1.16.0) (2026-07-04)

### Features

- add session delete button and functionality ([7396e41](https://github.com/pengjiantao/vscode-acp-chat/commit/7396e411c2b550e1a6114731ec12da05febbfcdd))

### Bug Fixes

- **session-manager:** ensure cold-start cache load regardless of call order ([9591dea](https://github.com/pengjiantao/vscode-acp-chat/commit/9591deaea680ce978b78b2ab260580ab42c6ce75))

### Code Refactoring

- consolidate session creation and info update into SessionManager ([48c0d0d](https://github.com/pengjiantao/vscode-acp-chat/commit/48c0d0d38e0c78e90b3704a5b3c4168fe2e6780e))
- **terminal:** remove VSCode terminal panel, spawn processes directly ([a94a7f9](https://github.com/pengjiantao/vscode-acp-chat/commit/a94a7f9c4579afd43bec9b431f0dd066eeb78da7))

### [1.15.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.15.0...v1.15.1) (2026-07-03)

### Bug Fixes

- **session-manager:** cache session stores per agent ([79332f4](https://github.com/pengjiantao/vscode-acp-chat/commit/79332f47a2ea31d20f3f4747ea25038adfe1a4ca))

### Code Refactoring

- **session-manager:** per-session key storage with cache and debounce ([ba79590](https://github.com/pengjiantao/vscode-acp-chat/commit/ba79590ba98db869c0d2a9716e7af737b8a7dd24))

## [1.15.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.14.0...v1.15.0) (2026-07-03)

### Features

- add local session cache for agents without session/list ([b6ca823](https://github.com/pengjiantao/vscode-acp-chat/commit/b6ca823d4e93b2d1a2b17de20e7308d915039225))
- gate session/list calls behind agent capability ([ab9863b](https://github.com/pengjiantao/vscode-acp-chat/commit/ab9863b15db33900a7b296ad1d4535e1ad804b13))

### Bug Fixes

- replace explicit any types in session_manager test with proper type annotations ([30ff145](https://github.com/pengjiantao/vscode-acp-chat/commit/30ff145024143e38cf37da9e466e0c2808475224))
- **webview:** use consistent guard in toolCallComplete handler ([1a8ac6b](https://github.com/pengjiantao/vscode-acp-chat/commit/1a8ac6b8f5d2bf250e748a0e2c4f63276678b170))

### Code Refactoring

- **webview:** decouple spinner management from tool renderers ([2e176ea](https://github.com/pengjiantao/vscode-acp-chat/commit/2e176ea2cb09a41c8445b3c964f8a4fa85abc828))

## [1.14.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.13.1...v1.14.0) (2026-07-03)

### Features

- **webview:** show line range in read tool summary ([c62646d](https://github.com/pengjiantao/vscode-acp-chat/commit/c62646d5aabecb780e2ea49c0a282e08409fe77d))

### Bug Fixes

- 修复命令输出 ANSI 渲染 ([b71e0dc](https://github.com/pengjiantao/vscode-acp-chat/commit/b71e0dc44cac5726f92d9fbe13ac966d72532910))

### Code Refactoring

- remove messageId stream tracking, simplify block management ([f656f14](https://github.com/pengjiantao/vscode-acp-chat/commit/f656f1410e3991e06ff24f6723a3a05356a21f46))

### [1.13.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.13.0...v1.13.1) (2026-07-03)

### Bug Fixes

- disable debug logging by default ([1033c98](https://github.com/pengjiantao/vscode-acp-chat/commit/1033c987f3bc60a01dd619de7964fe16d7b5cfd3))

## [1.13.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.12.3...v1.13.0) (2026-07-03)

### Features

- add debug logging for ACP session updates and multi-stream block tracking ([62fbab3](https://github.com/pengjiantao/vscode-acp-chat/commit/62fbab34ac6b888093fc1d8e60efc2b16518b473))
- add max-height and scroll to diff container ([61aa255](https://github.com/pengjiantao/vscode-acp-chat/commit/61aa2552ea9f12fff4821766eb59510272d1ba20))

### Bug Fixes

- ensure npx always uses latest package versions for claude-code and codex agents ([cd598c5](https://github.com/pengjiantao/vscode-acp-chat/commit/cd598c51a874feb6bc3871286b048809fbc8f29d))
- keep running tool blocks expanded when concurrent tools are spawned ([015677b](https://github.com/pengjiantao/vscode-acp-chat/commit/015677bba0d4e997fcb09577290837d509bcd082))
- pass workspace cwd to agent process spawn options ([df32ba5](https://github.com/pengjiantao/vscode-acp-chat/commit/df32ba5877b15f30ca292b7dbb1660ea1d0c28e5))
- serialize async tasks to prevent message ordering races ([67bc17e](https://github.com/pengjiantao/vscode-acp-chat/commit/67bc17e56d2535d7d29e832a9c561d6d942f5ef8))
- tighten block-text padding and suppress generic 'Other:' tool kind label ([13921b3](https://github.com/pengjiantao/vscode-acp-chat/commit/13921b3c522351e2bb161207aa3e7f7db53d762f))
- **webview:** add bottom margin to text-to-tool/thought CSS transition ([0dbc4e1](https://github.com/pengjiantao/vscode-acp-chat/commit/0dbc4e1ec6082e65a08d2c95bb5f55aff93b2599))

### Code Refactoring

- consolidate tool call state into single map and simplify CSS ([a903788](https://github.com/pengjiantao/vscode-acp-chat/commit/a903788020752d91c9fb0f3c85e22a3623e55f7e))
- extract FileHandler and TerminalHandler from ChatViewProvider ([fc6e443](https://github.com/pengjiantao/vscode-acp-chat/commit/fc6e4437c537afba248a2c04d723ccdcef04a89a))
- simplify terminal output handling and remove codex-acp \_meta streaming ([59becb4](https://github.com/pengjiantao/vscode-acp-chat/commit/59becb49d0471a760e1ce9a623d3e9f1b160c67a))

### [1.12.3](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.12.2...v1.12.3) (2026-06-29)

### Code Refactoring

- **webview:** use slash prefix for command chips ([a10b88c](https://github.com/pengjiantao/vscode-acp-chat/commit/a10b88c328bb53731d32a0778363a8d7cdde752a))

### [1.12.2](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.12.1...v1.12.2) (2026-06-29)

### Bug Fixes

- finalize live tool calls reliably ([20f7289](https://github.com/pengjiantao/vscode-acp-chat/commit/20f7289228b3a3f2c3111bceaf947ef30315ee84))
- handle colon-suffixed markdown file links ([b8eaec2](https://github.com/pengjiantao/vscode-acp-chat/commit/b8eaec235de88ef96e98ea741881006b87ef338e))
- **webview:** stabilize message scroll repaint ([82b9dc9](https://github.com/pengjiantao/vscode-acp-chat/commit/82b9dc9eccdf7a64d0978a1d9ae8eb6c76fd5f20))

### [1.12.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.12.0...v1.12.1) (2026-06-29)

### Bug Fixes

- correct test expectation for mention placeholder replacement ([13ca015](https://github.com/pengjiantao/vscode-acp-chat/commit/13ca0153dcf6fe02803cf04fbde813a1de8b3062))

## [1.12.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.9.2...v1.12.0) (2026-06-29)

### Features

- **chat:** allow clicking markdown file links to open them in editor ([fd96f47](https://github.com/pengjiantao/vscode-acp-chat/commit/fd96f47a99c2f470911f966fe5889bf2f21fda5d))
- **chat:** support codex-acp terminal output metadata streaming ([bcbc725](https://github.com/pengjiantao/vscode-acp-chat/commit/bcbc72505fe27d141f99c9c24e95644a1c51ec2e))
- sanitize MCP server names for agent compatibility ([40b3848](https://github.com/pengjiantao/vscode-acp-chat/commit/40b38489f697a6382046e140e4e0b68affcfdc99))
- support completed status directly on tool_call notifications ([3f298b3](https://github.com/pengjiantao/vscode-acp-chat/commit/3f298b311a57d93d6d594c12bda0d8ad2846d68d))
- **webview:** make diff headers clickable to open files ([c619ee3](https://github.com/pengjiantao/vscode-acp-chat/commit/c619ee3b765d7487f92db6f076cb9cff88354c40))
- **webview:** remove dropdown min-width and show metadata in tooltip ([73cd3fb](https://github.com/pengjiantao/vscode-acp-chat/commit/73cd3fb64f490c50bb4b88ec63a092c22a081ee3))

### Bug Fixes

- prevent metadata chunks from splitting user messages during history replay ([2796b5b](https://github.com/pengjiantao/vscode-acp-chat/commit/2796b5b6d50048d4574e294d134f2e880b7d3e41))

### Code Refactoring

- remove diff hunk click-to-jump and line selection features ([c656898](https://github.com/pengjiantao/vscode-acp-chat/commit/c656898d16938a451c54fdb87aae6f56e5f90774))

## [1.11.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.10.1...v1.11.0) (2026-06-27)

### Features

- **webview:** make diff headers clickable to open files ([c619ee3](https://github.com/pengjiantao/vscode-acp-chat/commit/c619ee3b765d7487f92db6f076cb9cff88354c40))

### [1.10.1](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.10.0...v1.10.1) (2026-06-27)

### Code Refactoring

- remove diff hunk click-to-jump and line selection features ([c656898](https://github.com/pengjiantao/vscode-acp-chat/commit/c656898d16938a451c54fdb87aae6f56e5f90774))

## [1.10.0](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.9.2...v1.10.0) (2026-06-27)

### Features

- **chat:** allow clicking markdown file links to open them in editor ([fd96f47](https://github.com/pengjiantao/vscode-acp-chat/commit/fd96f47a99c2f470911f966fe5889bf2f21fda5d))
- **webview:** remove dropdown min-width and show metadata in tooltip ([73cd3fb](https://github.com/pengjiantao/vscode-acp-chat/commit/73cd3fb64f490c50bb4b88ec63a092c22a081ee3))

### [1.9.2](https://github.com/pengjiantao/vscode-acp-chat/compare/v1.9.1...v1.9.2) (2026-06-24)

### Bug Fixes

- empty diff for new files written by some agents ([36acf96](https://github.com/pengjiantao/vscode-acp-chat/commit/36acf9650247b2b11fc5fdf0edc9c7784106ae8e))
- support plus-bracket ANSI escape codes in bash output ([0aa8739](https://github.com/pengjiantao/vscode-acp-chat/commit/0aa8739b385e50b40b3f6a5619d568faee59b252))

### Code Refactoring

- make diff change blocks clickable to open file at line ([111c432](https://github.com/pengjiantao/vscode-acp-chat/commit/111c4328c0a7b283fdb725913cc8a1362af11a75))
- replace line numbers with hunk headers in diff view ([f8930d5](https://github.com/pengjiantao/vscode-acp-chat/commit/f8930d57fa9e72f1065683020f170f67770644ea))

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
