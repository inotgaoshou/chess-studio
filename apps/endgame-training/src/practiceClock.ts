/** Active time only. A monotonic source keeps device clock changes out of results. */
export class PracticeClock {
  private saved = 0;
  private since: number | undefined;
  private readonly now: () => number;
  constructor(now: () => number = () => performance.now()) { this.now = now; }

  read(): number {
    return this.saved + (this.since === undefined ? 0 : Math.max(0, this.now() - this.since));
  }
  setRunning(running: boolean): void {
    if (running && this.since === undefined) this.since = this.now();
    else if (!running && this.since !== undefined) {
      this.saved = this.read();
      this.since = undefined;
    }
  }
  reset(elapsedMs = 0): void {
    this.saved = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    this.since = undefined;
  }
}
