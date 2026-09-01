/**
 * The run queue.
 *
 * One swarm holds twenty concurrent browsers, which is the whole Starter-plan
 * ceiling — so the server can run exactly one house-funded swarm at a time.
 * That constraint is not hidden; it is surfaced as a queue position and an ETA,
 * which turns "the site is busy" into "you're third, about two minutes".
 *
 * Visitors who bring their own keys spend against their own plan, so they skip
 * the queue entirely and are bounded only by a small ceiling that protects this
 * process from running out of memory.
 */

import type { Emit, RunMode, RunReport, RunRequest } from "./engine/types.js"

export interface QueuedRun {
  runId: string
  request: RunRequest
  mode: RunMode
  emit: Emit
  controller: AbortController
  resolve: (r: RunReport) => void
  reject: (e: unknown) => void
}

/** Rough time one swarm takes, used only for the ETA shown to waiters. */
const TYPICAL_RUN_SECONDS = 100

export class RunQueue {
  private readonly waiting: QueuedRun[] = []
  private active: QueuedRun | null = null

  constructor(private readonly maxDepth: number) {}

  get depth(): number {
    return this.waiting.length + (this.active ? 1 : 0)
  }

  get isFull(): boolean {
    return this.waiting.length >= this.maxDepth
  }

  enqueue(
    runId: string,
    request: RunRequest,
    mode: RunMode,
    emit: Emit,
    controller: AbortController,
  ): Promise<RunReport> {
    return new Promise<RunReport>((resolve, reject) => {
      const job: QueuedRun = { runId, request, mode, emit, controller, resolve, reject }
      this.waiting.push(job)

      const position = this.waiting.length + (this.active ? 1 : 0) - 1
      if (position > 0) {
        emit({
          type: "run:queued",
          runId,
          position,
          etaSeconds: position * TYPICAL_RUN_SECONDS,
        })
      }
      void this.pump()
    })
  }

  cancel(runId: string): boolean {
    if (this.active?.runId === runId) {
      this.active.controller.abort()
      return true
    }
    const i = this.waiting.findIndex((j) => j.runId === runId)
    if (i >= 0) {
      const [job] = this.waiting.splice(i, 1)
      job?.reject(new Error("cancelled"))
      this.broadcastPositions()
      return true
    }
    return false
  }

  private async pump(): Promise<void> {
    if (this.active) return
    const job = this.waiting.shift()
    if (!job) return

    this.active = job
    this.broadcastPositions()

    try {
      const report = await job.mode.run(job.request, job.emit, job.controller.signal)
      job.resolve(report)
    } catch (err) {
      job.emit({
        type: "run:error",
        message: err instanceof Error ? err.message : String(err),
      })
      job.reject(err)
    } finally {
      this.active = null
      void this.pump()
    }
  }

  private broadcastPositions(): void {
    this.waiting.forEach((job, i) => {
      const position = i + (this.active ? 1 : 0)
      job.emit({
        type: "run:queued",
        runId: job.runId,
        position,
        etaSeconds: position * TYPICAL_RUN_SECONDS,
      })
    })
  }
}
