# Entry Offline AI Panel - Minimal Spec for Codex

## Goal
Add a small AI panel to Entry Offline.
The panel lets the user talk to an AI that edits the current project JSON.

## Main UI
- Add a small `AI` button in the editor UI.
- Clicking the button toggles the AI panel open/closed.
- Panel state can stay in memory only.

## Panel Inputs
- API Key input
- Model input
- Max Tokens input
- Min Tokens input
- User prompt textarea
- Send button

## While Generating
- When AI generation starts, lock the project UI like when a project is running.
- User must not be able to edit sprites, scenes, scripts, variables, or assets while generation is in progress.
- Show loading state.
- Unlock only after success or failure.

## AI Request Input
Send these to the AI:
1. user prompt
2. current project JSON (`Entry.getStartProject()` result or equivalent)

## AI Response Format
AI must return strict JSON only:

```json
{
  "updatedProject": { "...": "full updated project json" },
  "changeSummary": [
    "Added player object",
    "Created scene 2",
    "Updated script for enemy"
  ]
}
```

## Apply Flow
1. Read current project JSON.
2. Send prompt + current JSON to AI.
3. Receive strict JSON response.
4. Validate response.
5. Replace current project with `updatedProject`.
6. Show `changeSummary` in panel.

## Validation Rules
Minimum validation only:
- response must be valid JSON
- `updatedProject` must exist
- `changeSummary` must be an array of strings
- reject empty response
- reject response if root type is not object
- reject response if `updatedProject` is not object

## Token Settings
- `Max Tokens` maps to request output limit.
- `Min Tokens` is local app logic only.
- If response is shorter than `Min Tokens`, treat as failure or retry once.

## API Key Handling
- Store API key locally only.
- Do not hardcode key in source.
- Prefer local settings file or secure local storage.
- Do not commit real keys.

## Suggested Files
- `src/renderer/ai/AIButton.*`
- `src/renderer/ai/AIPanel.*`
- `src/renderer/ai/AIStore.*`
- `src/renderer/ai/AIRequest.*`
- `src/renderer/ai/AIValidator.*`
- `src/renderer/ai/AIApplyProject.*`

## Behavior Notes
- Keep implementation minimal.
- No advanced history/versioning yet.
- No diff viewer yet.
- No streaming required.
- No multi-turn tool calling required.
- No block-by-block generation UI required.
- Just prompt in, full updated JSON out.

## System Prompt Draft
You edit Entry project JSON.
User gives a natural language request and the current project JSON.
Return JSON only.
Do not include markdown.
Do not explain outside JSON.
Always return:
- `updatedProject`: full valid updated project JSON
- `changeSummary`: short array of human-readable changes
Preserve unrelated existing project data when possible.

## Dev Notes
- Keep code simple and readable.
- Make AI panel easy to remove later.
- Separate UI, request logic, validation, and project-apply logic.
