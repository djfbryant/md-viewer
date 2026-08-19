# MarkShare

A private writing club for Markdown. Invited creators sign in with an email code, write in the browser, and send a read-only share link. Anyone with that URL can read. There is no public Edit Link.

## Run locally

```sh
npm install
cp .env.example .env.local
npm run dev
```

The shell can run without a real Instant app; Instant initializes only when `VITE_INSTANT_APP_ID` is set. Create or select an Instant app and put that value in `.env.local`:

```sh
npx instant-cli init-without-files --title MarkShare
```

Push the writing-club schema and permission rules:

```sh
npx instant-cli push schema --yes
npx instant-cli push perms --yes
```

Do not migrate anonymous Instant data from the previous pastebin model. Start empty, or delete old `documents` rows in Instant Explorer.

## Invite a creator, then try it

1. In Instant Explorer, add a `creators` row. Set `email` to the invitee's address in lowercase. Do not link `$user` yourself; the app does that on first sign-in.
2. Open the app, choose **Sign in**, enter that email, and submit the magic code Instant emails.
3. **Create a document**, write Markdown, **Save changes**. The editor URL becomes `/d/{id}`. Copy the share link from **Share**.
4. Open `/s/{id}` in a private window (signed out). You should see a read-only document and no Edit control.
5. Open the same share link while signed in as the owner. **Edit** should return you to the document.

A person who is not on `creators` can still complete a magic code. They land signed in with “You are not invited.” and cannot save.

To grant another creator edit, they must already have signed in once. The owner types that email in **Share** → **Editors**.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

## Deploy to Vercel

Import this repository in Vercel (or run `npx vercel`). Set `VITE_INSTANT_APP_ID` in Project Settings → Environment Variables for Preview and Production. `vercel.json` builds the Vite app and serves the SPA shell.

The application uses self-hosted Inter assets from `@fontsource/inter`; it makes no Google Fonts request.

Share Links, signed-in document URLs, unknown paths, `/new`, and `/sign-in` send `X-Robots-Tag: noindex, nofollow, noarchive` and `Referrer-Policy: no-referrer`. Home, About, Privacy, and Acceptable use are indexable. `robots.txt` disallows `/s/`, `/d/`, `/e/`, `/new`, and `/sign-in`. Link previews stay on the generic MarkShare title and description. A signed-in creator is rate-limited to 20 new documents per hour and 60 image uploads per hour. Reloading does not reset the budget.

Expired and deleted documents stay unavailable immediately. A daily Vercel cron at `/api/cleanup` then removes those records and any owned images. Set these server-only variables in Vercel (and `.env.local` if you invoke the route locally):

```
INSTANT_APP_ADMIN_TOKEN=your-instant-admin-token
CRON_SECRET=a-long-random-string
```

`INSTANT_APP_ID` may be set as well; otherwise the cleanup job uses `VITE_INSTANT_APP_ID`. After changing the Instant schema or permission rules, push both:

```sh
npx instant-cli push schema --yes
npx instant-cli push perms --yes
```

## Responsive verification

The responsive test protects the shell lock and both breakpoints. Before a release, run the app and check the following browser measurements at 700px height: `document.documentElement.scrollWidth === clientWidth` and `scrollHeight === clientHeight`. Use 1920, 1440, 1280, 1024, 900, 768, 620, 420, and 320px widths. At 900px the splitter must remain visible; below it, Edit/Preview tabs replace the split panes. This browser pass was completed for this bootstrap.
