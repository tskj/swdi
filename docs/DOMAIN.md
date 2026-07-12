# Moving to a real domain

The sync base URL is currently the generated Railway domain. Every extension copy carries
it (manifest host permissions and the settings default), so the domain should exist before
the extension is shared with anyone. This is the step-by-step for when the domain is bought.

The Railway-generated domain stays active alongside the custom one, so nothing breaks
during the switch; devices move over as their extension is rebuilt and reloaded.

## 1. Point the domain at Railway

1. In the Railway dashboard, open the web service (the Next.js app), then
   Settings, then Networking, and add a custom domain.
2. Railway shows the DNS record to create. For a subdomain (for example
   `app.example.org`) this is a CNAME to the target Railway prints. For an apex domain
   (`example.org`) use your registrar's ALIAS or ANAME record type if plain CNAME is not
   allowed at the apex.
3. Create that record at the registrar and wait for Railway to show the domain as ready.
   Certificate provisioning is automatic and usually takes a few minutes after DNS
   propagates.
4. Verify: `curl https://YOUR_DOMAIN/api/health` answers 200.

## 2. Swap the URL in code

The URL lives in exactly two places:

1. `shared/src/schema.ts`: `SYNC_DEFAULT_BASE_URL`. This is the default sync endpoint for
   new installs and the dashboard link in the popup.
2. `extension/manifest.json`: `host_permissions`. Keep the old Railway entry in the list
   during the transition so devices that have not migrated their stored settings can still
   sync; drop it later once every device is over.

Then rebuild and verify:

```
pnpm --filter @swdi/extension build
pnpm typecheck && pnpm lint && pnpm test
npx playwright test
```

## 3. Migrate devices that already have the extension

Stored settings keep the URL they were saved with, so existing installs continue to point
at the Railway domain (which keeps working). To move them over, add a one-time migration
in `extension/src/lib/storage.ts` `loadSettings`: if the stored `syncBaseUrl` equals the
old Railway URL, rewrite it to the new domain and save. Remove the migration a release
later. With only personal devices in play, editing the stored value by hand via the
service worker console is an acceptable shortcut.

After swapping, reload the unpacked extension on each device (the manifest change
requires it), then run a sync from the popup and confirm the dashboard link opens the new
domain.

## 4. Aftercare

- Update the README if it names the app URL anywhere by then.
- Consider updating the SWDI entry in `registry/registry.json` if the project site moves
  to the new domain.
- Once every device syncs against the new domain, remove the Railway entry from
  `host_permissions` and delete the settings migration.
