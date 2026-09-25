// A scene's imports from its host (`@host/…`, aliased per project in lib/engine/bundle/project-bundle.ts) type as `any`. Checking
// them for real would pull the host's internals into the studio's tsc, under the studio's settings: a real app
// fails there (its own path aliases, Bun or Vite globals, server-only modules). `studio look` is the check instead.
declare module '@host/*';
