# Gemini Terminal UI — Vercel ready

A terminal-style Gemini web UI using the current Google GenAI JavaScript SDK and Interactions API.

## Fixed file handling

- Text/Markdown/code files are decoded and sent as actual text content.
- PDF files use the current `document` input type.
- Images, audio and video use their corresponding multimodal input types.
- ZIP project uploads are unpacked server-side and supported source/text files are provided to Gemini with filenames.
- Streaming uses the current `step.delta` event format.

## Run

```bash
npm install
npm run dev
```

## Vercel

Import the repository into Vercel and deploy. You can optionally set `GEMINI_API_KEY` as a Vercel environment variable.

## Important

A Vercel serverless function is not a persistent local terminal. It cannot safely expose arbitrary shell access to the Vercel host. This UI handles Gemini model interactions and uploaded project context. A full coding-agent terminal requires a sandbox/managed-agent backend.

Never commit API keys. If a real key was exposed publicly, rotate it in Google AI Studio.
