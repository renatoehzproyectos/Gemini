# Gemini Agent Workspace

Vercel-ready Gemini Antigravity coding agent UI using the Google Gen AI JavaScript SDK and Interactions API.

## Important upload behavior

Gemini managed environments support inline sources up to 1 MB per file and 2 MB total. For complete or larger repositories, configure a GitHub/GitLab/Bitbucket repository URL in Settings instead of attaching a large ZIP.

The app persists the Antigravity environment ID and previous interaction ID locally so later turns reuse the same Linux sandbox. When new sources are attached to an existing environment, the API request uses `environment_id + sources` so the sources are mounted into the existing sandbox instead of being silently ignored.
