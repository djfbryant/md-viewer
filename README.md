# MarkShare

A calm, private Markdown sharing application. This bootstrap provides the deployable Vercel shell, the authoritative Split Desk design system, a responsive document workspace, theme preference persistence, and the InstantDB configuration boundary for the document features that follow.

## Run locally

```sh
npm install
cp .env.example .env.local
npm run dev
```

The shell can run without a real Instant app; its Instant client initializes only when `VITE_INSTANT_APP_ID` is supplied. Before adding document persistence, create or select an Instant app and set that value in `.env.local`:

```sh
npx instant-cli init-without-files --title MarkShare
```

Use `npx instant-cli push schema --yes` after adding that value to provision `instant.schema.ts`.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

## Deploy to Vercel

Import this repository in Vercel (or run `npx vercel`). Set `VITE_INSTANT_APP_ID` in Project Settings → Environment Variables for Preview and Production. `vercel.json` builds the Vite app and serves the SPA shell for future share-link routes.

The application uses self-hosted Inter assets from `@fontsource/inter`; it makes no Google Fonts request.

## Responsive verification

The responsive test protects the shell lock and both breakpoints. Before a release, run the app and check the following browser measurements at 700px height: `document.documentElement.scrollWidth === clientWidth` and `scrollHeight === clientHeight`. Use 1920, 1440, 1280, 1024, 900, 768, 620, 420, and 320px widths. At 900px the splitter must remain visible; below it, Edit/Preview tabs replace the split panes. This browser pass was completed for this bootstrap.
