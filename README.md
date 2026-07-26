# Custos Desktop

Electron client for [Custos](https://github.com/Citizen-Forge/custos) — the software delivery tool, not just a chat window.

A project opens as four tabs:

- **Steering Co** — adversarial ideation. Runs on the project's strongest configured model with a persona whose job is to stress-test an idea rather than agree with it. The only way out is a handoff, which drops a brief into the roadmap inbox.
- **Product Roadmap** — the inbox of handed-off ideas, and the epics the product owner agent has broken them into, with their stories nested underneath.
- **Board** — a kanban board of stories and bugs moving through backlog → ready → in progress → QA → complete, worked by engineer and QA agents.
- **DevOps** — deployment target, agent and infrastructure budgets, concurrency ceiling, per-role autonomy switches, the agent roster with live cost/quality stats, and the run activity feed.

## Why the networking lives in the main process

All Custos HTTP and WebSocket traffic goes through the Electron main process rather than the renderer. The renderer's origin (`file://` in production, `localhost:5173` in dev) is a different site from wherever Custos is hosted, so the `SameSite=Lax` session cookie set by `/login` would never be sent back on a renderer-initiated cross-site request, and CORS would block it regardless. Node's networking has no CORS or SameSite concept, so the cookie is tracked in `src/main/custos-client.ts` and attached by hand. The renderer talks to it over IPC.

## Development

```sh
npm install
npm run dev        # electron-vite dev server + Electron
npm run typecheck  # main, preload and renderer
npm run build      # production bundle
```

On first launch, point it at a Custos instance (base URL and admin password). Credentials are not written to disk beyond the server URL; the session lives in memory.

## Layout

```
src/main/       Electron main process — all Custos networking, IPC handlers
src/preload/    contextBridge surface exposed to the renderer as window.custos
src/renderer/   React UI: project shell and the four tabs
src/shared/     types mirrored from the gateway's own API
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free to use, modify and share for any noncommercial purpose. Same terms as [Custos](https://github.com/Citizen-Forge/custos) itself.
