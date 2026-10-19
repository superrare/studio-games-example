import { applyInput, advance, createRun, score } from './target-engine.js';
import type { TargetState } from './target-engine.js';
import type { Configuration } from './config.js';
export class Practice {
  private state: TargetState | undefined;
  private timer: number | undefined;
  private startedAt = 0;
  private host: HTMLElement;

  constructor(host: HTMLElement, private game: Configuration['game'], private onEnd: (score: number) => void) {
    this.host = host;
  }

  start(): void {
    this.stop();
    const arena = document.createElement('div');
    arena.className = 'practice-arena';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const scoreLabel = document.createElement('p');
    const controls = document.createElement('div');
    controls.className = 'practice-controls';
    const send = (input: Record<string, unknown>) => {
      const state = this.state;
      if (!state || state.gameOver) return;
      this.state = applyInput(state, input, this.tick());
      this.render(status, scoreLabel);
    };
    if (this.game === 'target-rush') {
      const hit = document.createElement('button');
      hit.type = 'button';
      hit.textContent = 'Hit target';
      hit.addEventListener('click', () => send({ action: 'hit', targetId: this.state?.target.id }));
      controls.append(hit);
    } else {
      for (const color of ['red', 'blue', 'green', 'gold']) {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.textContent = color;
        choice.addEventListener('click', () => send({ action: 'choose', targetId: this.state?.target.id, color }));
        controls.append(choice);
      }
    }
    const quit = document.createElement('button');
    quit.type = 'button';
    quit.className = 'secondary';
    quit.textContent = 'End practice';
    quit.addEventListener('click', () => this.stop());
    controls.append(quit);
    arena.append(status, scoreLabel, controls);
    this.host.replaceChildren(arena);
    this.host.hidden = false;
    this.startedAt = performance.now();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] as number;
    this.state = applyInput(createRun(seed, { maxTicks: 240, roundTicks: 200, game: this.game }), { action: 'start' }, 0);
    this.render(status, scoreLabel);
    this.timer = window.setInterval(() => {
      const state = this.state;
      if (!state) return;
      this.state = advance(state, this.tick());
      this.render(status, scoreLabel);
      if (this.state.gameOver) {
        const finalScore = score(this.state);
        this.stop();
        this.host.hidden = false;
        this.host.textContent = `Practice score: ${finalScore}. This score is local and was not recorded.`;
        this.onEnd(finalScore);
      }
    }, 100);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.state = undefined;
    this.host.replaceChildren();
    this.host.hidden = true;
  }

  private tick(): number { return Math.floor((performance.now() - this.startedAt) / 50); }

  private render(status: HTMLElement, scoreLabel: HTMLElement): void {
    const state = this.state;
    if (!state) return;
    const remaining = Math.max(0, state.rules.roundTicks - (state.tick - (state.startTick ?? state.tick)));
    status.textContent = this.game === 'color-match'
      ? `Practice · choose ${state.target.color} · ${((remaining * 50) / 1000).toFixed(1)}s left`
      : `Practice · target ${state.target.id} · ${((remaining * 50) / 1000).toFixed(1)}s left`;
    scoreLabel.textContent = `Unrecorded practice score: ${score(state)}`;
  }
}
