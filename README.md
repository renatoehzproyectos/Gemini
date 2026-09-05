# Gemini — Agent Workspace

A polished Vercel-ready Gemini application powered by Google's Interactions API and Antigravity managed agent.

## Capabilities

Google's Antigravity managed agent provides a secure remote Linux sandbox with filesystem management, code execution, web search and URL context. This UI exposes those capabilities through a normal AI workspace instead of a terminal-themed interface.

- Persistent API key in browser localStorage (change/remove from Settings)
- Stateful multi-turn conversations
- Persistent chat list/history in browser storage
- Remote Linux workspace that persists across turns
- Read/create/edit/rename/move/delete/search files
- Bash, Python and Node execution
- Package installation
- Tests, linters and builds
- Google Search and URL context
- Project/ZIP upload
- File attachments
- Streaming responses
- Streaming thinking summaries (when Gemini provides them)
- Visible agent/tool activity
- Background execution mode
- Stop/cancel running background interaction
- Download sandbox snapshot
- Export chat JSON
- Model selection for supported Antigravity models
- Custom agent instructions
- Responsive mobile UI

## Important limitations

This is the maximum capability exposed by the current public Antigravity managed-agent API; it cannot directly control the user's local phone/PC filesystem from a Vercel website. Uploaded files are copied into Google's remote sandbox, and edits happen there. The resulting environment can be downloaded as a snapshot.

The API key is deliberately stored only in the browser's localStorage when entered in Settings. This is convenient for a personal deployment, but it is not a server-side secret store. For a shared/public deployment, prefer the Vercel `GEMINI_API_KEY` environment variable or an authentication layer.

## Deploy

```bash
npm install
npm run build
```

Then push to GitHub and deploy the repository on Vercel.

Never commit a real API key.

## Official API basis

The project uses the current Interactions API and the `antigravity-preview-05-2026` managed agent. Antigravity supplies the sandbox, filesystem, code execution and web tools; thinking summaries are displayed from the API's `thought_summary` stream events when available.
