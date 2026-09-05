# Gemini Terminal UI

A Vercel-ready Next.js interface that gives you a terminal-style Gemini experience in the browser.

## What it includes

- Paste a Google AI Studio / Gemini API key.
- Terminal-style chat interface.
- Streaming model output.
- Conversation context.
- Multiple file attachments.
- Multimodal image/audio/video/PDF input.
- Model selector.
- Mobile-friendly UI.
- Server-side Gemini requests so the key is not sent directly to Google from the browser.
- Vercel Node.js runtime.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

Push this folder to GitHub and import the repository into Vercel.

Optional production setup:

```text
GEMINI_API_KEY=your_key_here
```

If `GEMINI_API_KEY` is present, the API route can use it. The UI can also send a session key through the `x-gemini-api-key` request header.

## Important limitation

A browser UI on Vercel cannot literally reproduce every local-terminal capability. A local CLI can access your machine's filesystem, shell, installed programs, git credentials, and unrestricted local processes. Vercel serverless functions do not provide that same persistent local machine.

For a true coding-agent/terminal replacement, add a sandbox/agent backend. Gemini's newer Interactions API supports managed remote agent environments; that is the appropriate architecture for shell/file operations without giving a web request arbitrary access to the Vercel host.

## Security

Do not commit API keys. If you pasted a real key into a public chat or repository, revoke/rotate it in Google AI Studio and create a new one.
