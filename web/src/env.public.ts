// env.public.ts: what any module may read of Vite's environment, the browser's included. Not `env.client`: Start's
// import protection keeps a `.client` module out of the server, and the root route renders there too.

/** True under Vite's dev server; false in `studio lab --export`'s build. */
export const isViteDevServer: boolean = import.meta.env.DEV;
