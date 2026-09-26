#!/usr/bin/env node
// ─── The structural tier's entry point ────────────────────────────────
//
// `run-structural-checks.ts` exports the orchestrator and runs nothing on
// import: executing that file directly prints nothing and exits 0, which is the
// silent-clean failure this whole tier exists to make impossible. This module is
// the one that actually runs.
//
// Invoke it through the launcher, never a bare `node` — see
// `lint/with-real-node.sh`:
//
//   lint/with-real-node.sh lint/structural/check-structure.ts
//
// ──────────────────────────────────────────────────────────────────────

import { architectureConfig } from "./arch.config.ts";
import { structuralChecks } from "./registry.ts";
import { reportStructuralChecks } from "./run-structural-checks.ts";

process.exitCode = reportStructuralChecks(structuralChecks, architectureConfig);
