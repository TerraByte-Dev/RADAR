# README screenshots

Captured from the built app, never drawn. `e2e/readme.spec.ts` writes all five:

```bash
npm run build
RADAR_README_SHOTS=1 npx playwright test -c e2e readme.spec.ts
```

The data is the invented set from `scripts/demo-data.mjs`: one made-up developer, Robin, and
Robin's side projects; no real project or person appears. Window content 1280×800, reduced motion, the mockup's
bearings on the Scope, the last visit set three days back so Pick up shows its digest.

| File | View | What it shows |
|---|---|---|
| `pick-up.png` | Pick up, dark | Continue for Tidewatch (live session), the This week group, the scope panel and the digest |
| `project-page.png` | Cloud Glide's project page, dark | The Now line, the next-step card, the queue with its first row open, the session log |
| `scope.png` | The Scope, dark | Every project by time since last work, focus pins, the live session; paused projects are hollow where their last work puts them, archived ones sit hollow on the rim |
| `log.png` | The Log, dark | Every project's entries under day headings, newest first |
| `pick-up-light.png` | Pick up, light | The same board in the light theme |
