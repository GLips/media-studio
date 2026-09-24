# Sale-only view — client walkthrough storyboard

**Audience:** the Painful Pleasures team. Voiceover and captions, about 80 s.
**Source:** PR #333's preview theme, captured as screenshots and animated with camera moves, a cursor and highlights.

**Takeaway:** a shopper who clicks a sale item lands on the options that are actually on sale.

The words live in `voiceover.json`; each scene's `note` in `video.tsx` says what it shows. See it all, with stills per
line and a playable preview, with `node scripts/storyboard.ts projects/2026-09-sale-only-view`.

## Deliberately left out

- The mechanics of the `?on-sale` URL and Intelligems setup. They're internal, and the rollout scene just says that
  it's tested.
- Logged-in pro and distributor footage. That needs test accounts, so the pricing scene states it as text instead.
- The collection-card badge change, where sold-out variants no longer count toward "Up to X%". It's real, but it's a
  second story and would blur this one.
