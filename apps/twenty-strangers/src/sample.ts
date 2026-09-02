/**
 * The canned run behind "Watch a sample".
 *
 * Someone who has never heard of this should be able to see what the report
 * looks like before deciding whether to spend anything. That is worth doing
 * properly, and it is worth being scrupulous about: the sample uses an
 * obviously fictional target and is flagged `isSample` all the way through, so
 * the UI can say plainly that this is a demonstration and not a scan of
 * anybody's site. A fabricated report presented as a real one would be the
 * worst thing this app could do.
 */

import type { RunRequest } from "./engine/types.js"

export const SAMPLE_RUN: RunRequest = {
  target: "https://example-saas.invalid",
  objective: "work out whether this is worth paying for",
  siteType: "saas",
  international: true,
  swarmSize: 20,
  isSample: true,
}
