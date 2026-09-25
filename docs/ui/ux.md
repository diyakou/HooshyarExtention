# Hooshyar UI/UX Upgrade Proposal

## هدف

Repository:

```text
https://github.com/diyakou/HooshyarExtention
```

را از نظر UI/UX بررسی و ارتقا بده.

هدف این پروژه این است که تجربه کاربری Hooshyar از یک AI Chat Extension معمولی به یک **Agent-first coding interface در سطح VS Code Copilot Chat** تبدیل شود.

تمرکز این task فقط روی:

```text
UI
UX
Interaction Design
Agent Feedback
Context UX
Approval UX
Session UX
Diff UX
Plan UX
```

است.

Backend و Agent architecture فعلی را تا جای ممکن حفظ کن و فقط در صورت نیاز برای UI integration تغییر بده.

---

# 1. قبل از هر تغییر

ابتدا کل UI فعلی پروژه را inspect کن.

مشخص کن:

```text
Webview files
CSS files
JS/TS UI files
ChatViewProvider
message protocol
state management
session/history UI
model selector
tool rendering
approval rendering
diff/revert controls
input composer
inline chat UI
```

سپس یک گزارش کوتاه بده:

```text
Current UI Structure
Current UX Problems
Reusable Components
Components To Refactor
Components To Create
```

بدون این بررسی مستقیماً UI جدید نساز.

---

# 2. Design Goal

Hooshyar نباید ظاهری شبیه یک chatbot ساده داشته باشد.

هدف:

```text
AI Coding Workspace
```

نه:

```text
ChatGPT inside VS Code
```

UI باید:

```text
compact
developer-focused
native-looking
clear
fast
low-noise
context-aware
agent-aware
```

باشد.

از design tokenهای VS Code استفاده کن.

تا جای ممکن:

```css
var(--vscode-editor-background)
var(--vscode-sideBar-background)
var(--vscode-foreground)
var(--vscode-descriptionForeground)
var(--vscode-input-background)
var(--vscode-input-border)
var(--vscode-button-background)
var(--vscode-panel-border)
var(--vscode-list-hoverBackground)
var(--vscode-focusBorder)
var(--vscode-errorForeground)
```

استفاده شود.

Hardcoded color فقط در صورت ضرورت.

Dark/Light theme هر دو باید درست باشند.

---

# 3. Chat Layout جدید

Chat View باید سه بخش اصلی داشته باشد:

```text
┌──────────────────────────────┐
│ Session Header               │
├──────────────────────────────┤
│                              │
│ Conversation                 │
│                              │
├──────────────────────────────┤
│ Composer                     │
└──────────────────────────────┘
```

---

# 4. Session Header

بالای Chat View:

```text
┌─────────────────────────────────────┐
│ Hooshyar                  +   ⋯     │
│ Fix authentication issue            │
└─────────────────────────────────────┘
```

Controls:

```text
New Session
Session History
Rename Session
Delete Session
Clear Session
Open in Editor
```

اگر session در حال اجرا است:

```text
● Running
```

اگر approval لازم دارد:

```text
◐ Approval required
```

اگر تمام شده:

```text
✓ Completed
```

---

# 5. Session List

یک session/history UI بهتر ایجاد کن.

نمونه:

```text
SESSIONS

＋ New Session

TODAY

● Add refresh token
✓ Fix Laravel route bug
✓ Refactor payment service

YESTERDAY

○ Explain database schema
✓ Improve API validation
```

Session status icons:

```text
● Running
◐ Waiting
✓ Completed
! Failed
○ Idle
```

Session item باید context menu داشته باشد:

```text
Open
Rename
Duplicate
Delete
```

---

# 6. Ask / Plan / Agent Mode

یکی از مهم‌ترین تغییرات.

بالای یا پایین composer یک mode selector اضافه کن:

```text
[ Ask ] [ Plan ] [ Agent ]
```

یا compact:

```text
Agent ▾
```

Modes:

## Ask

Description:

```text
Answers questions without modifying files.
```

Tool policy:

```text
read-only
```

## Plan

Description:

```text
Analyzes the project and creates an implementation plan.
```

نباید فایل تغییر دهد.

## Agent

Description:

```text
Can edit files, run commands and complete tasks.
```

Mode انتخاب‌شده باید همیشه واضح باشد.

---

# 7. Composer Redesign

Composer فعلی را به command center تبدیل کن.

Target:

```text
┌──────────────────────────────────────────┐
│ Ask Hooshyar...                          │
│                                          │
│ [auth.ts ×] [Problems ×]                 │
│                                          │
│ + Context                        ⌘ Enter │
├──────────────────────────────────────────┤
│ Agent ▾   Sonnet ▾   Safe ▾          ↑  │
└──────────────────────────────────────────┘
```

Composer باید شامل:

```text
textarea
context chips
Add Context
mode picker
model picker
permission picker
send button
stop button
context usage
```

باشد.

---

# 8. Multiline Input

Textarea باید:

```text
auto grow
```

کند.

حداکثر مثلاً:

```text
8 lines
```

بعد scroll داخلی.

Shortcuts:

```text
Enter
or
Cmd/Ctrl + Enter
```

بر اساس setting فعلی پروژه.

نمایش shortcut در UI.

---

# 9. Context Chips

Contextهای اضافه‌شده باید به‌صورت chip نمایش داده شوند.

مثلاً:

```text
[ auth.service.ts × ]
[ Selection · 42 lines × ]
[ Problems · 3 × ]
[ Git Changes × ]
```

هر chip:

```text
icon
name
type
remove button
```

Tooltip:

```text
Full path
Token estimate
Context type
```

---

# 10. Add Context Picker

دکمه:

```text
+ Context
```

باز کند:

```text
Files
Folders
Selection
Open Editors
Symbols
Problems
Terminal
Git Changes
Tests
Codebase
```

Search field:

```text
Search files and symbols...
```

Keyboard navigation کامل:

```text
Arrow Up
Arrow Down
Enter
Escape
```

---

# 11. # Mentions

در textarea پشتیبانی کن:

```text
#
```

بعد picker باز شود.

Examples:

```text
#file
#folder
#selection
#problems
#terminal
#git
#tests
#codebase
```

اگر architecture فعلی اجازه می‌دهد file/symbol autocomplete هم اضافه شود.

---

# 12. Model Picker

Model picker را polished کن.

نمونه:

```text
Claude Sonnet 5 ▾
```

Dropdown:

```text
Claude Sonnet 5
Claude Opus 5
Claude Sonnet 4.6
...
```

اطلاعات optional:

```text
context length
multiplier
provider
```

اما UI را شلوغ نکن.

Selected model فقط نام کوتاه نشان دهد.

---

# 13. Permission Picker

Permission control باید مستقیماً کنار composer باشد.

مثلاً:

```text
Safe ▾
```

Modes:

```text
Ask Every Time
Safe
Auto Edit
Full Access
```

تعریف:

## Ask Every Time

```text
Ask before file edits and commands.
```

## Safe

```text
Auto approve read-only and safe tools.
```

## Auto Edit

```text
Auto approve workspace edits.
Ask before commands.
```

## Full Access

```text
Allow workspace actions automatically.
```

Destructive commandها در Full Access نیز در صورت policy فعلی می‌توانند warning داشته باشند.

---

# 14. Context Usage Indicator

کنار composer:

```text
Context 34%
```

یا یک circular/simple progress indicator.

Click:

```text
Context Usage

Conversation      6.4K
Files             4.2K
Rules               800
Tool Results       1.7K
System             1.2K

Total             14.3K / 64K
```

اگر token info فعلاً backend ندارد:

ابتدا estimated character/token usage نمایش بده.

Architecture را طوری بساز که بعداً token دقیق اضافه شود.

---

# 15. High Context Warning

اگر context > threshold:

```text
Context 82% ⚠
```

نمایش بده.

Action:

```text
Compact
```

یا:

```text
Manage Context
```

---

# 16. Conversation Messages

Message hierarchy را بهبود بده.

User:

```text
You
Add authentication refresh tokens
```

Assistant:

```text
Hooshyar
...
```

از bubbleهای بزرگ شبیه Messenger خودداری کن.

Developer/editor UI مناسب‌تر:

```text
avatar/icon
name
content
metadata
```

Spacing کم ولی خوانا.

---

# 17. Markdown Rendering

Support:

```text
headings
lists
tables
blockquote
code
inline code
links
```

Code block header:

```text
TypeScript                       Copy
```

Optional:

```text
Insert
Apply
```

در code blocks مرتبط.

---

# 18. File Reference UI

وقتی Agent به فایل اشاره می‌کند:

```text
auth.service.ts:34-67
```

باید clickable باشد.

Click:

```text
open file
reveal line
```

Hover:

```text
path
line range
```

---

# 19. Tool Call Cards

تمام tool calls را از raw text جدا کن.

Base component:

```text
ToolCard
```

Types:

```text
SearchToolCard
ReadToolCard
EditToolCard
TerminalToolCard
TestToolCard
DiagnosticToolCard
GenericToolCard
```

---

# 20. Search Tool Card

نمونه:

```text
┌────────────────────────────────┐
│ 🔎 Searched codebase           │
│ authentication middleware      │
│                                │
│ 12 results                     │
│                       Expand ▾ │
└────────────────────────────────┘
```

Expanded:

```text
auth.ts
middleware/auth.ts
user.service.ts
...
```

Fileها clickable باشند.

---

# 21. Read File Tool Card

```text
┌──────────────────────────────┐
│ Read 4 files                 │
│                              │
│ auth.service.ts              │
│ auth.routes.ts               │
│ token.service.ts             │
│ auth.test.ts                 │
└──────────────────────────────┘
```

Default collapsed.

---

# 22. Terminal Tool Card

```text
┌────────────────────────────────┐
│ > npm test -- auth             │
│                                │
│ ✓ Exit code 0                  │
│ 18 tests passed                │
│                                │
│                     Output ▾   │
└────────────────────────────────┘
```

Failure:

```text
✕ Exit code 1
3 tests failed
```

stderr visually distinguish شود ولی theme-safe.

---

# 23. File Edit Tool Card

```text
┌──────────────────────────────┐
│ Edited auth.service.ts       │
│ +18  -4                      │
│                              │
│ Review Changes               │
└──────────────────────────────┘
```

برای چند فایل:

```text
Changed 4 files
+82 -14
```

---

# 24. Tool Loading State

هنگام اجرای tool:

```text
◌ Searching codebase...
```

یا:

```text
◌ Running npm test...
```

spinner subtle.

از animation سنگین استفاده نکن.

---

# 25. Agent Progress Timeline

بزرگ‌ترین UX improvement.

در زمان Agent execution:

```text
Working

✓ Analyzed workspace
✓ Found authentication flow
✓ Read 4 files
✓ Updated token service
● Running tests
○ Verify changes
```

هر step:

```text
pending
running
success
warning
failed
```

Timeline collapsible باشد.

---

# 26. No Chain-of-Thought UI

هیچ private reasoning یا raw chain-of-thought نمایش داده نشود.

فقط action summary:

Bad:

```text
I think I should inspect this because...
```

Good:

```text
Searching authentication flow
```

---

# 27. Current Activity Footer

هنگام اجرا در پایین conversation:

```text
◌ Running tests
```

یا:

```text
◌ Searching workspace
```

با:

```text
Stop
```

---

# 28. Stop Button

وقتی Agent فعال است send button تبدیل شود به:

```text
■ Stop
```

Stop باید event مناسب backend را ارسال کند.

اگر backend cancellation کامل نیست، UI infrastructure را آماده کن.

---

# 29. Steering During Execution

در صورت امکان input را هنگام execution disable نکن.

User باید بتواند message جدید بفرستد:

```text
Don't modify the database.
```

اگر backend فعلاً steering support ندارد:

message را queue کن.

UI نشان دهد:

```text
Queued
```

---

# 30. Approval Cards

Approvalها نباید فقط modal باشند.

Inline card:

```text
┌─────────────────────────────────┐
│ Hooshyar wants to run           │
│                                 │
│ npm install jsonwebtoken        │
│                                 │
│ Network access                  │
│ Modifies dependencies           │
│                                 │
│ [Allow] [Always Allow] [Reject] │
└─────────────────────────────────┘
```

---

# 31. Edit Approval Card

```text
Hooshyar wants to edit 4 files

auth.service.ts       +18 -4
routes.ts             +12
token.ts              +42
auth.test.ts          +38

[Review]
[Accept]
[Reject]
```

---

# 32. Approval UX

Button hierarchy:

Primary:

```text
Allow
Accept
```

Secondary:

```text
Review
```

Danger:

```text
Reject
```

Avoid accidental approval.

---

# 33. Diff Review UI

بعد از file changes:

```text
CHANGES

4 files
+82 -14

M auth.service.ts
M auth.routes.ts
A refresh-token.ts
M auth.test.ts

[Review All]
[Keep All]
[Undo All]
```

---

# 34. Per-file Actions

در هر فایل:

```text
Keep
Undo
Open
```

اگر architecture امکان می‌دهد:

```text
Accept File
Reject File
```

---

# 35. Diff Editor Integration

Review Changes باید تا جای ممکن از native VS Code diff editor استفاده کند.

نه custom HTML diff اگر لازم نیست.

Use:

```text
vscode.diff
```

یا infrastructure فعلی پروژه.

---

# 36. Plan Mode UI

Plan output نباید markdown ساده باشد.

Component:

```text
PlanCard
```

نمونه:

```text
Implementation Plan

✓ Analyze current authentication

1. Token Service
   Add refresh token support

2. API
   Add /auth/refresh endpoint

3. Storage
   Store refresh token hashes

4. Tests
   Add authentication tests

Affected files: 6
Risk: Medium

[Implement Plan]
[Edit Plan]
```

---

# 37. Plan Execution Progress

بعد از Implement Plan:

```text
PLAN

✓ Analyze project
✓ Update token service
● Add API endpoint
○ Add tests
○ Verify
```

Plan component باید stateful باشد.

---

# 38. Edit Plan

دکمه:

```text
Edit Plan
```

حداقل نسخه:

plan content را در textarea/editor قرار دهد.

User بتواند تغییر دهد.

سپس:

```text
Save Plan
```

---

# 39. Todo Panel

اگر Agent task breakdown دارد:

```text
TASKS 3/6

✓ Inspect project
✓ Locate auth flow
✓ Update models
● Update API
○ Add tests
○ Verify
```

Collapsible.

در sidebar باریک default collapsed.

---

# 40. Status Language

به جای:

```text
Working...
```

از status دقیق استفاده کن:

```text
Searching...
Reading files...
Planning...
Editing...
Running command...
Running tests...
Waiting for approval...
Verifying...
```

---

# 41. Error Card

Errorها را داخل chat واضح نمایش بده.

```text
⚠ Command failed

npm test

3 tests failed.

[View Output]
[Retry]
```

نه raw stacktrace به‌صورت پیش‌فرض.

---

# 42. Retry UX

برای failureهایی که retry ممکن است:

```text
Retry
```

برای provider:

```text
Retry Request
```

برای MCP:

```text
Reconnect
```

---

# 43. Empty State

وقتی session خالی است:

```text
Hooshyar

What do you want to build?

[Explain code]
[Fix an issue]
[Plan a feature]
[Review changes]
```

زیرش suggestionهای کوچک.

از landing page شلوغ خودداری کن.

---

# 44. Suggested Prompt UX

Prompt suggestionها contextual باشند.

اگر git changes وجود دارد:

```text
Review my changes
Generate commit message
```

اگر problems وجود دارد:

```text
Fix workspace problems
```

اگر selection فعال است:

```text
Explain selection
Refactor selection
```

---

# 45. Chat Editor

Command اضافه کن:

```text
Hooshyar: Open Chat in Editor
```

یک WebviewPanel/editor tab باز کند.

مثلاً:

```text
Hooshyar: Fix Authentication
```

Full-width chat.

همان session state sidebar باید حفظ شود.

---

# 46. Chat Editor Layout

در عرض زیاد:

```text
┌────────────┬───────────────────────┐
│ Plan/Tasks │ Conversation          │
│            │                       │
│            │                       │
└────────────┴───────────────────────┘
```

Sidebar panel داخل chat editor optional.

در عرض کم:

single column.

---

# 47. Responsive Design

Width breakpoints تعریف کن.

مثلاً:

```text
< 380px compact
380-700px normal
> 700px wide
```

Compact mode:

```text
hide secondary labels
collapse tool details
compact selectors
```

---

# 48. Toolbar Icons

برای actions از Codicons استفاده کن.

مثلاً:

```text
$(add)
$(history)
$(settings-gear)
$(close)
$(chevron-down)
$(terminal)
$(search)
$(file-code)
$(check)
$(error)
$(debug-stop)
```

از emoji در production UI استفاده نکن مگر intentional.

---

# 49. Accessibility

تمام controlها:

```text
aria-label
keyboard navigation
focus states
```

داشته باشند.

Tab order منطقی باشد.

Escape:

```text
close menu
close picker
cancel popup
```

---

# 50. Keyboard UX

حداقل shortcuts UI-side:

```text
Cmd/Ctrl + Enter → Send
Escape → close popup
Cmd/Ctrl + K → context picker optional
Up/Down → menu navigation
Enter → select
```

اگر shortcut با VS Code conflict دارد اضافه نکن.

---

# 51. Scroll UX

وقتی Agent output جدید می‌دهد:

اگر user در bottom است:

```text
auto-follow
```

اگر user بالا scroll کرده:

auto-scroll نکن.

دکمه:

```text
↓ New activity
```

نمایش بده.

---

# 52. Long Tool Output

Raw tool output default collapsed.

مثلاً:

```text
Terminal output · 137 lines
```

با:

```text
Expand
```

بعد virtualized/scrollable content.

هیچ tool output 500-line مستقیم conversation را پر نکند.

---

# 53. Markdown Table Overflow

Tableهای بزرگ horizontal scroll داشته باشند.

layout chat را نشکنند.

---

# 54. Code Block UX

Code block header:

```text
auth.ts                     Copy
```

در صورت وجود file metadata:

```text
auth.ts · lines 20-43
```

clickable.

---

# 55. Copy Feedback

بعد Copy:

```text
Copied
```

برای ~1 second.

---

# 56. User Feedback Actions

روی assistant message:

```text
Copy
Regenerate
```

Optional:

```text
Good
Bad
```

اگر telemetry نداریم، Good/Bad لازم نیست.

---

# 57. Regenerate

Regenerate باید همان user request قبلی را دوباره اجرا کند.

اگر Agent تغییر فایل داده:

قبل از regenerate conflict-aware باشد.

اگر backend support ندارد، button را اضافه نکن تا function واقعی وجود داشته باشد.

---

# 58. Context Inspector

یک popover/panel ایجاد کن:

```text
Context
```

نمایش:

```text
Active file
Selection
Attached files
Rules
Skills
Git changes
Problems
Conversation
```

اگر token estimates موجود است نشان بده.

---

# 59. Context Inspector Actions

از همین panel:

```text
Remove
Open
Pin
```

اگر pin architecture وجود ندارد فقط Remove/Open.

---

# 60. Pin Context

Optional P1 feature:

File/context را pin کن:

```text
Pinned for this session
```

تا در requestهای بعدی باقی بماند.

---

# 61. Rule/Skill Indicator

اگر Rules یا Skills فعال‌اند:

composer header کوچک:

```text
2 Rules
1 Skill
```

Click:

```text
View active rules
View active skills
```

برای transparency.

---

# 62. MCP Indicator

اگر MCP فعال است:

```text
MCP · 3 servers
```

Click:

```text
Server A ✓
Server B ✓
Server C !
```

P1.

---

# 63. Provider Status

اگر provider unavailable:

composer:

```text
Provider unavailable
```

send disabled یا clear error.

Button:

```text
Retry Connection
```

---

# 64. Streaming Text UX

Text streaming smooth باشد.

نباید کل message هر token rerender شود اگر performance افت می‌کند.

Batch updates:

مثلاً:

```text
30-60ms
```

یا requestAnimationFrame.

---

# 65. Rendering Performance

Conversation با صدها messages نباید کند شود.

در صورت نیاز:

```text
virtualization
lazy tool expansion
memoized rendering
```

اما dependency سنگین بدون نیاز اضافه نکن.

---

# 66. Component Architecture

Webview را component-based کن.

اگر پروژه framework ندارد:

لزومی ندارد React وارد کنی مگر benefit واضح داشته باشد.

Vanilla/Preact/React بر اساس ساختار فعلی تصمیم بگیر.

هدف:

```text
maintainable components
```

نه rewrite بی‌دلیل.

---

# 67. Suggested Components

حداقل منطقی:

```text
ChatApp
SessionHeader
SessionList
Conversation
Message
MarkdownRenderer

Composer
ModePicker
ModelPicker
PermissionPicker
ContextPicker
ContextChip
ContextUsage

ToolCard
SearchToolCard
TerminalToolCard
EditToolCard

ApprovalCard
ChangeSummary
PlanCard
TaskList
AgentTimeline

Dropdown
Popover
Tooltip
Button
IconButton
```

---

# 68. State Model

UI state را واضح تعریف کن.

مثلاً:

```ts
interface ChatUIState {
    session;
    messages;
    mode;
    selectedModel;
    permissionMode;

    contextItems;

    agentStatus;
    currentActivity;

    plan;
    tasks;

    pendingApproval;

    contextUsage;
}
```

State پراکنده در DOM attributes نباشد.

---

# 69. Extension ↔ Webview Protocol

Message types را strongly typed کن.

مثلاً:

```ts
type WebviewToExtensionMessage =
    | { type: 'sendMessage'; payload: ... }
    | { type: 'stopAgent' }
    | { type: 'setMode'; mode: ... }
    | { type: 'setModel'; model: ... }
    | { type: 'setPermissionMode'; mode: ... }
    | { type: 'addContext'; ... }
    | { type: 'removeContext'; ... }
    | { type: 'approveTool'; ... }
    | { type: 'rejectTool'; ... };
```

و:

```ts
type ExtensionToWebviewMessage =
    | { type: 'state'; ... }
    | { type: 'streamChunk'; ... }
    | { type: 'toolStarted'; ... }
    | { type: 'toolFinished'; ... }
    | { type: 'approvalRequested'; ... }
    | { type: 'agentStatus'; ... };
```

---

# 70. No Stringly Typed Events

از:

```text
"tool_started"
"TOOLSTART"
```

پراکنده جلوگیری کن.

Enums/unions مشترک.

---

# 71. VS Code Theme Integration

همه حالت‌ها تست شوند:

```text
Dark+
Light+
High Contrast
```

Minimum contrast حفظ شود.

---

# 72. Font

از VS Code fonts:

```css
font-family: var(--vscode-font-family);
font-size: var(--vscode-font-size);
```

Code:

```css
font-family: var(--vscode-editor-font-family);
```

---

# 73. Border Radius

UI باید VS Code-like باشد، نه mobile app.

از radius خیلی بزرگ:

```text
16px
24px
```

برای همه چیز خودداری کن.

Recommended:

```text
4px
6px
```

---

# 74. Shadows

Shadow خیلی کم.

VS Code mostly flat UI.

Hierarchy با:

```text
border
background
spacing
```

ساخته شود.

---

# 75. Spacing System

یک scale ثابت:

```text
4
8
12
16
24
```

استفاده کن.

CSS custom properties:

```css
--space-1
--space-2
...
```

---

# 76. Empty Tool Noise

Read/search toolهای بسیار کوچک را می‌توان group کرد.

مثلاً 5 بار `read_file` پشت سرهم:

```text
Read 5 files
```

به جای 5 card.

---

# 77. Tool Grouping

Group by logical step:

```text
Explore codebase
  searched 3 queries
  read 7 files
```

اما output مهم terminal/edit جدا بماند.

---

# 78. Agent Completion Summary

در پایان task:

```text
Completed

4 files changed
18 tests passed
No diagnostics

[Review Changes]
```

اگر failure:

```text
Completed with issues

4 files changed
3 tests failed

[Review]
[View Failures]
```

---

# 79. Final Response Separation

Agent completion state و assistant prose جدا باشند.

مثلاً:

```text
✓ Task completed
```

بعد explanation.

---

# 80. Toast Usage

Toast فقط برای:

```text
connection error
copied
saved
fatal background problem
```

از toast برای هر tool action استفاده نکن.

---

# 81. Settings Shortcut

Menu:

```text
⋯
```

شامل:

```text
New Session
Open in Editor
Model Settings
Provider Settings
MCP
Rules
Skills
Extension Settings
```

---

# 82. Mobile-like UI ممنوع

از این موارد خودداری کن:

```text
huge cards
gradient backgrounds
large rounded pills everywhere
marketing-style hero
oversized icons
```

این developer tool است.

---

# 83. Visual Priority

باید hierarchy این باشد:

```text
1. User prompt
2. Current Agent activity
3. Result
4. Changes
5. Tool details
6. Metadata
```

Tool internals نباید مهم‌تر از result دیده شوند.

---

# 84. P0 Implementation

در اولین مرحله حتماً پیاده کن:

```text
Ask/Plan/Agent selector
Composer redesign
Model picker cleanup
Permission picker
Context chips
Add Context picker
Agent progress timeline
Tool cards
Inline approval cards
Change summary
Plan card
Session header
Session statuses
Stop button
Responsive UI
VS Code theme integration
```

---

# 85. P1

بعد:

```text
Session list redesign
Open Chat in Editor
Context usage
Context inspector
Task panel
# mentions
Tool grouping
Context pinning
Rule/Skill indicator
MCP status
```

---

# 86. P2

بعد:

```text
wide chat editor layout
separate Agents dashboard
advanced session manager
parallel agent visualization
background sessions
```

---

# 87. Agents Dashboard

P2 feature.

Command:

```text
Hooshyar: Open Agents
```

UI:

```text
AGENTS

Running
─────────────────────────
● Implement authentication
  Agent · Sonnet 5
  Running tests

Waiting
─────────────────────────
◐ Database migration
  Waiting for approval

Completed
─────────────────────────
✓ Fix API error
  5 files · 12 tests
```

---

# 88. Agents Dashboard Actions

هر session:

```text
Open
Stop
Resume
Delete
```

در آینده:

```text
Duplicate
Archive
```

---

# 89. Accessibility Acceptance Criteria

UI قابل استفاده فقط با keyboard باشد.

تمام menus:

```text
focus trapping where needed
Escape closes
Arrow navigation
Enter selects
```

Button بدون accessible label نباشد.

---

# 90. UX Acceptance Scenario 1

User:

```text
Fix authentication tests
```

UI باید نشان دهد:

```text
Agent
Claude Sonnet
Safe
```

بعد:

```text
✓ Found 4 authentication tests
✓ Read AuthService
● Running tests
```

Terminal card:

```text
npm test -- auth
3 failed
```

بعد edit approval.

بعد:

```text
✓ 3 tests fixed
✓ 18 tests passed
```

و:

```text
Review Changes
```

---

# 91. UX Acceptance Scenario 2

User mode:

```text
Plan
```

Prompt:

```text
Add subscription billing
```

UI:

```text
Planning...
```

سپس structured PlanCard.

هیچ edit یا command execution destructive انجام نشود.

دکمه:

```text
Implement Plan
```

---

# 92. UX Acceptance Scenario 3

Context:

```text
auth.ts
Problems
Git Changes
```

باید chips واضح باشند.

User قبل از send بداند AI چه contextی دارد.

---

# 93. UX Acceptance Scenario 4

Agent command نیاز دارد:

```text
npm install package
```

Inline approval card ظاهر شود.

Conversation block نشود.

---

# 94. UX Acceptance Scenario 5

Agent task طولانی است.

User scroll کرده بالا.

output جدید نباید scroll او را به پایین ببرد.

دکمه:

```text
↓ New activity
```

ظاهر شود.

---

# 95. UX Acceptance Scenario 6

Agent در حال اجراست.

User:

```text
Stop
```

UI فوراً:

```text
Stopping...
```

سپس:

```text
Stopped
```

نشان دهد.

---

# 96. UX Acceptance Scenario 7

Light theme و Dark theme هر دو:

```text
readable
no hardcoded broken colors
correct hover
correct focus
correct disabled state
```

---

# 97. Testing

برای UI unit test یا component test هر جا ساختار پروژه اجازه می‌دهد.

حداقل تست برای:

```text
mode switching
permission switching
context chips
tool card rendering
approval state
agent status
stop action
session selection
```

---

# 98. Manual Test Checklist

حتماً این viewportها تست شوند:

```text
300px sidebar
380px sidebar
500px sidebar
800px editor
1200px editor
```

Themes:

```text
Dark
Light
High Contrast
```

---

# 99. Regression

این قابلیت‌ها نباید شکسته شوند:

```text
chat streaming
model selection
API provider
history
MCP
Skills
Rules
image attachment
inline chat
inline completion
diff
revert
command approval
write approval
```

---

# 100. Implementation Strategy

این کار را یکجا rewrite نکن.

ترتیب:

## Phase 1

```text
Inspect current UI
Create common design tokens
Refactor composer
Mode/model/permission selectors
```

## Phase 2

```text
Context chips
Context picker
Message rendering
Tool cards
```

## Phase 3

```text
Agent timeline
Approval cards
Change summary
Plan card
```

## Phase 4

```text
Session UX
Responsive UI
Chat Editor
```

## Phase 5

```text
Context usage
Context inspector
Agents dashboard
```

---

# 101. بعد از هر Phase

گزارش:

```text
Implemented:
Changed files:
Screens/UI affected:
Backend protocol changes:
Tests:
Known issues:
Next:
```

سپس test/build اجرا کن.

---

# 102. Build Validation

در پایان هر phase:

```text
npm install
npm run compile
npm run lint
npm test
```

یا commandهای واقعی repository.

هر compile/type error مربوط به تغییرات باید رفع شود.

---

# 103. Screenshot Validation

بعد از بخش‌های مهم، اگر environment اجازه می‌دهد extension را run کن و visually بررسی کن.

موارد:

```text
empty state
normal chat
agent running
tool call
approval
plan
diff summary
session list
```

---

# 104. ممنوع

نباید:

```text
backend فعلی را بدون نیاز rewrite کنی
UI را React rewrite کنی فقط چون راحت‌تر است
hardcoded dark colors استفاده کنی
raw JSON tool calls نشان دهی
raw chain-of-thought نشان دهی
هر tool را به modal تبدیل کنی
textarea را هنگام agent execution کامل disable کنی
tool outputs طولانی را default expand کنی
session history فعلی را از بین ببری
API compatibility فعلی را بشکنی
```

---

# 105. De
