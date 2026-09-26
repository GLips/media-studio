import { createCsrfMiddleware, createStart } from '@tanstack/react-start';

// The server functions write notes and cue lists on this machine, so a page on another site mustn't reach them.
const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' });

// Every screen plays media or a live composition in the browser (Remotion's Player, <video>, Web Audio), so nothing is
// rendered on the server: the document is the shell, and each route renders in the page.
export const startInstance = createStart(() => ({ defaultSsr: false, requestMiddleware: [csrfMiddleware] }));
