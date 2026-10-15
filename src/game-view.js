import { LEVELS } from './game-engine.js';

const WIDTH = 800;
const HEIGHT = 450;
const PALETTES = [
  { sky: '#a4e6ef', low: '#e7f6cd', hills: '#7eb99d', far: '#afd2a5', earth: '#73624d', top: '#b1e777', accent: '#214f4b', name: 'Meadow circuit' },
  { sky: '#ecb9a4', low: '#ffe3ae', hills: '#a77999', far: '#cf9eaa', earth: '#765466', top: '#ffce8c', accent: '#673c61', name: 'Sunset terraces' },
  { sky: '#252e61', low: '#59639a', hills: '#505489', far: '#3d4478', earth: '#3c3b5f', top: '#a5c7eb', accent: '#dbe8ff', name: 'Starlight summit' },
];
const MOVEMENT_KEYS = new Map([
  ['ArrowLeft', 'left'], ['KeyA', 'left'], ['ArrowRight', 'right'], ['KeyD', 'right'],
  ['Space', 'jump'], ['ArrowUp', 'jump'], ['KeyW', 'jump'],
]);
let nextViewId = 0;

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text) result.textContent = text;
  return result;
}

export class GameView {
  constructor({ root, variant, onInput }) {
    this.variant = variant;
    this.onInput = onInput;
    this.view = null;
    this.previousView = null;
    this.snapshotAt = performance.now();
    this.snapshotInterval = 50;
    this.disposed = false;
    this.active = false;
    this.held = new Map();
    this.lastMove = { direction: 0, jump: false };
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.listeners = [];
    this.buttons = [];
    this.wrapper = node('div', `game-view game-view--${variant}`);
    const stage = node('div', 'game-stage');
    this.canvas = node('canvas', 'game-canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', variant === 'flappy-bird' ? 'Sky Hopper game canvas' : 'Star Runner game canvas');
    this.canvas.textContent = 'This game requires a browser with canvas support. Controls and run status are provided below.';
    this.context = this.canvas.getContext('2d');
    this.instructions = node('p', 'game-instructions');
    this.instructions.id = `game-instructions-${++nextViewId}`;
    this.instructions.textContent = variant === 'flappy-bird'
      ? 'Tap the sky, press Space or ↑, or use Flap to fly between the pipes. Each press gives one flap. Controls unlock after you start a paid play.'
      : 'Move with ← → or A / D. Jump with Space, ↑ or W. Collect stars, avoid spikes, and reach the beacon in all three levels. Release jump before jumping again. Controls unlock after you start a paid play.';
    this.canvas.setAttribute('aria-describedby', this.instructions.id);
    this.readout = node('p', 'sr-only');
    this.readout.setAttribute('role', 'status');
    this.readout.setAttribute('aria-live', 'polite');
    const controls = node('div', 'touch-controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', variant === 'flappy-bird' ? 'Flight controls' : 'Runner controls');
    if (variant === 'flappy-bird') {
      controls.append(this.control('Flap ↑', 'flap', 'Give the bird one flap'));
    } else {
      controls.append(this.control('←', 'left', 'Move left'), this.control('→', 'right', 'Move right'));
      const jump = this.control('Jump ↑', 'jump', 'Jump; release before jumping again');
      jump.classList.add('jump-control');
      controls.append(jump);
    }
    stage.append(this.canvas);
    this.wrapper.append(stage, this.instructions, controls, this.readout);
    root.append(this.wrapper);
    this.listen(window, 'keydown', (event) => this.key(event, true));
    this.listen(window, 'keyup', (event) => this.key(event, false));
    this.listen(window, 'blur', () => this.release());
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.release();
    });
    this.listen(this.wrapper, 'focusout', (event) => {
      if (!this.wrapper.contains(event.relatedTarget)) this.release();
    });
    this.listen(this.canvas, 'pointerdown', (event) => {
      if (!this.active || event.button !== 0) return;
      event.preventDefault();
      this.canvas.focus({ preventScroll: true });
      if (this.variant === 'flappy-bird') this.onInput({ action: 'flap' });
    });
    this.reset();
    const frame = (time) => {
      if (this.disposed) return;
      this.draw(time);
      this.animation = requestAnimationFrame(frame);
    };
    this.animation = requestAnimationFrame(frame);
  }

  listen(target, type, callback) {
    target.addEventListener(type, callback);
    this.listeners.push(() => target.removeEventListener(type, callback));
  }

  control(label, action, accessibleLabel) {
    const button = node('button', 'arcade-control', label);
    button.type = 'button';
    button.disabled = true;
    button.setAttribute('aria-label', accessibleLabel);
    this.buttons.push(button);
    this.listen(button, 'pointerdown', (event) => {
      if (!this.active || event.button !== 0) return;
      event.preventDefault();
      button.focus({ preventScroll: true });
      button.setPointerCapture(event.pointerId);
      this.press(`pointer:${event.pointerId}`, action, true);
    });
    const releasePointer = (event) => this.press(`pointer:${event.pointerId}`, action, false);
    this.listen(button, 'pointerup', releasePointer);
    this.listen(button, 'pointercancel', releasePointer);
    this.listen(button, 'lostpointercapture', releasePointer);
    this.listen(button, 'keydown', (event) => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) this.press(`button:${action}:${event.code}`, action, true);
    });
    this.listen(button, 'keyup', (event) => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      this.press(`button:${action}:${event.code}`, action, false);
    });
    // Assistive technology can activate a button without pointer or key events.
    this.listen(button, 'click', (event) => {
      if (event.detail !== 0) return;
      const source = `activate:${action}`;
      this.press(source, action, true);
      this.press(source, action, false);
    });
    return button;
  }

  key(event, down) {
    const action = this.variant === 'flappy-bird'
      ? (event.code === 'Space' || event.code === 'ArrowUp' ? 'flap' : null)
      : MOVEMENT_KEYS.get(event.code);
    if (!action) return;
    const source = `key:${event.code}`;
    if (!down && this.held.has(source)) {
      event.preventDefault();
      this.press(source, action, false);
      return;
    }
    if (!this.active || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.closest('input, textarea, select, a, [contenteditable="true"], summary')) return;
      if (target.closest('button') && !this.wrapper.contains(target)) return;
    }
    event.preventDefault();
    if (!event.repeat) this.press(source, action, down);
  }

  press(source, action, down) {
    if (!this.active) return;
    if (down) {
      if (this.held.has(source)) return;
      this.held.set(source, action);
      if (action === 'flap') this.onInput({ action: 'flap' });
    } else {
      this.held.delete(source);
    }
    if (this.variant === 'platformer') this.sendMove();
  }

  sendMove() {
    const actions = new Set(this.held.values());
    const direction = Number(actions.has('right')) - Number(actions.has('left'));
    const jump = actions.has('jump');
    if (direction === this.lastMove.direction && jump === this.lastMove.jump) return;
    this.lastMove = { direction, jump };
    this.onInput({ action: 'move', direction, jump });
  }

  release() {
    this.held.clear();
    if (this.active && this.variant === 'platformer') this.sendMove();
    this.lastMove = { direction: 0, jump: false };
  }

  render(view) {
    if (this.disposed) return;
    if (this.view !== view) {
      const now = performance.now();
      const previous = this.view;
      if (this.variant === 'flappy-bird' && previous?.started && view.started
        && !previous.gameOver && !view.gameOver && previous.tick < view.tick) {
        this.previousView = previous;
        this.snapshotInterval = Math.max(16, Math.min(100, now - this.snapshotAt));
      } else {
        this.previousView = null;
      }
      this.snapshotAt = now;
      this.view = view;
    }
    const active = view.started && !view.gameOver;
    if (!active) {
      this.active = false;
      this.release();
    }
    this.active = active;
    for (const button of this.buttons) button.disabled = !active;
    const level = this.variant === 'platformer' ? ` Level ${view.platform.level + 1}/3.` : '';
    const status = `${view.outcome}.${level} Score ${view.score}.`;
    if (this.readout.textContent !== status) this.readout.textContent = status;
  }

  reset() {
    if (this.disposed) return;
    this.release();
    this.view = null;
    this.previousView = null;
    this.snapshotAt = performance.now();
    this.active = false;
    for (const button of this.buttons) button.disabled = true;
    this.readout.textContent = 'Ready. Start a paid play using the Play button. Preview only; no run has started.';
    this.draw(performance.now());
  }
  interpolationAmount(time) {
    if (this.reducedMotion || !this.previousView || this.variant !== 'flappy-bird') return 1;
    return Math.max(0, Math.min(1, (time - this.snapshotAt) / this.snapshotInterval));
  }

  dispose() {
    if (this.disposed) return;
    this.release();
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
    this.wrapper.remove();
  }

  draw(time) {
    if (this.reducedMotion) time = 0;
    const ctx = this.context;
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.imageSmoothingEnabled = false;
    if (this.variant === 'flappy-bird') this.drawFlappy(ctx, time);
    else this.drawPlatform(ctx, time);
    this.drawHud(ctx);
    if (!this.view?.started) this.drawOverlay(ctx, false);
    else if (this.view.gameOver) this.drawOverlay(ctx, true);
  }

  sky(ctx, top, bottom, time, camera = 0, night = false) {
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (night) {
      ctx.fillStyle = '#fff0c7';
      for (let i = 0; i < 31; i++) {
        const x = ((i * 137 + 41 - camera * 0.08) % 840 + 840) % 840;
        const y = 35 + (i * 73) % 215;
        ctx.fillRect(x, y, i % 4 === 0 ? 4 : 2, 2);
      }
    }
    ctx.fillStyle = night ? '#f6e0ba' : '#fff3bb';
    ctx.beginPath();
    ctx.arc(665, 93, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = night ? '#ffffff17' : '#ffffffb0';
    for (let i = 0; i < 6; i++) {
      const drift = time / 1700 + camera * 0.16;
      const x = ((i * 187 - drift) % 1050 + 1050) % 1050 - 120;
      const y = 88 + (i % 3) * 60;
      ctx.beginPath();
      ctx.ellipse(x, y, 44, 13, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 26, y - 10, 30, 21, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 55, y, 36, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  hills(ctx, color, base, camera, scale) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT);
    for (let x = -100; x <= WIDTH + 100; x += 20) {
      const height = Math.sin((x + camera * scale) / 135) * 25 + Math.sin((x + camera * scale) / 77) * 13;
      ctx.lineTo(x, base + height);
    }
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.closePath();
    ctx.fill();
  }

  drawFlappy(ctx, time) {
    this.sky(ctx, '#68cddd', '#e6f9d4', time);
    this.hills(ctx, '#acd4ab', 337, time / 18, 0.1);
    this.hills(ctx, '#7db9a5', 377, time / 18, 0.2);
    const state = this.view?.flappy;
    const previous = this.previousView?.flappy;
    const alpha = this.interpolationAmount(time);
    const pipes = state?.pipes ?? [{ id: 0, x: 485, gapY: 155 }, { id: 1, x: 745, gapY: 122 }];
    for (const pipe of pipes) {
      let x = pipe.x;
      if (previous) {
        for (const oldPipe of previous.pipes) {
          if (oldPipe.id === pipe.id) {
            x = oldPipe.x + (pipe.x - oldPipe.x) * alpha;
            break;
          }
        }
      }
      this.pipe(ctx, x, 0, pipe.gapY, true);
      this.pipe(ctx, x, pipe.gapY + 156, HEIGHT - pipe.gapY - 156, false);
    }
    const idle = !this.view?.started;
    const y = idle ? 206 + Math.sin(time / 360) * 6
      : previous ? previous.y + (state.y - previous.y) * alpha : state.y;
    const vy = previous ? previous.vy + (state.vy - previous.vy) * alpha : state?.vy ?? 0;
    ctx.save();
    ctx.translate(172, y + 12);
    ctx.rotate(idle ? -0.08 : Math.max(-0.35, Math.min(0.8, vy / 18)));
    // Original little sky courier: teal wings, golden body, and a tiny coral scarf.
    ctx.fillStyle = '#213f4a';
    ctx.fillRect(-13, -10, 25, 21);
    ctx.fillStyle = '#ffcb62';
    ctx.fillRect(-10, -9, 20, 18);
    ctx.fillStyle = '#fff2bb';
    ctx.fillRect(-8, 2, 16, 6);
    ctx.fillStyle = '#238b91';
    ctx.fillRect(-15, -1 + Math.sin(time / 90) * 2, 13, 9);
    ctx.fillStyle = '#fffdf1';
    ctx.fillRect(3, -8, 8, 8);
    ctx.fillStyle = '#203342';
    ctx.fillRect(8, -6, 3, 4);
    ctx.fillStyle = '#ef805c';
    ctx.fillRect(10, -1, 8, 5);
    ctx.fillRect(-10, 8, 15, 3);
    ctx.fillRect(-17, 9, 9, 4);
    ctx.restore();
    ctx.fillStyle = '#263f42';
    ctx.fillRect(0, HEIGHT - 7, WIDTH, 7);
    ctx.fillStyle = '#bbdb97';
    ctx.fillRect(0, HEIGHT - 10, WIDTH, 3);
  }

  pipe(ctx, x, y, height, upper) {
    if (height <= 0) return;
    ctx.fillStyle = '#285b60';
    ctx.fillRect(x, y, 64, height);
    ctx.fillStyle = '#559b89';
    ctx.fillRect(x + 4, y, 56, height);
    ctx.fillStyle = '#8bceac';
    ctx.fillRect(x + 8, y, 8, height);
    ctx.fillStyle = '#34766f';
    ctx.fillRect(x + 50, y, 10, height);
    const capY = upper ? y + height - 20 : y;
    ctx.fillStyle = '#244e54';
    ctx.fillRect(x - 4, capY, 72, 20);
    ctx.fillStyle = '#78b99b';
    ctx.fillRect(x, capY + 4, 64, 12);
    ctx.fillStyle = '#b7e4ba';
    ctx.fillRect(x + 3, capY + 4, 58, 3);
  }

  drawPlatform(ctx, time) {
    const state = this.view?.platform;
    const index = state?.level ?? 0;
    const level = LEVELS[index];
    const palette = PALETTES[index];
    const x = state?.x ?? 84;
    const y = state?.y ?? 370;
    const camera = Math.max(0, Math.min(level.width - WIDTH, x - 260));
    this.sky(ctx, palette.sky, palette.low, time, camera, index === 2);
    this.hills(ctx, palette.far, 300, camera, 0.18);
    this.hills(ctx, palette.hills, 350, camera, 0.35);
    ctx.save();
    ctx.translate(-camera, 0);
    for (const platform of level.platforms) {
      if (platform.x + platform.w < camera || platform.x > camera + WIDTH) continue;
      ctx.fillStyle = palette.earth;
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
      ctx.fillStyle = '#00000020';
      ctx.fillRect(platform.x, platform.y + 10, platform.w, 6);
      ctx.fillStyle = palette.top;
      ctx.fillRect(platform.x, platform.y, platform.w, 7);
      ctx.fillStyle = '#ffffff26';
      for (let mark = platform.x + 12; mark < platform.x + platform.w - 4; mark += 28) {
        ctx.fillRect(mark, platform.y + 21, 8, 3);
      }
    }
    for (const hazard of level.hazards) {
      if (hazard.x + hazard.w < camera || hazard.x > camera + WIDTH) continue;
      ctx.fillStyle = '#6d344d';
      ctx.fillRect(hazard.x, hazard.y + hazard.h - 5, hazard.w, 5);
      const count = Math.max(1, Math.floor(hazard.w / 15));
      for (let i = 0; i < count; i++) {
        const left = hazard.x + i * hazard.w / count;
        ctx.fillStyle = '#ffe0b9';
        ctx.beginPath();
        ctx.moveTo(left, hazard.y + hazard.h);
        ctx.lineTo(left + hazard.w / count / 2, hazard.y);
        ctx.lineTo(left + hazard.w / count, hazard.y + hazard.h);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e57c79';
        ctx.beginPath();
        ctx.moveTo(left + hazard.w / count / 2, hazard.y);
        ctx.lineTo(left + hazard.w / count, hazard.y + hazard.h);
        ctx.lineTo(left + hazard.w / count / 2, hazard.y + hazard.h);
        ctx.fill();
      }
    }
    for (let i = 0; i < level.coins.length; i++) {
      if (state?.coins.includes(i)) continue;
      const coin = level.coins[i];
      if (coin.x < camera - 20 || coin.x > camera + WIDTH + 20) continue;
      this.star(ctx, coin.x, coin.y, 10, '#fff0a0', '#b87a34');
    }
    const goal = level.goalX;
    ctx.fillStyle = '#324959';
    ctx.fillRect(goal, 286, 6, 114);
    ctx.fillStyle = '#fff0a0';
    ctx.fillRect(goal - 3, 282, 12, 8);
    ctx.fillStyle = '#5ecdb1';
    ctx.beginPath();
    ctx.moveTo(goal + 6, 292);
    ctx.lineTo(goal + 54, 304);
    ctx.lineTo(goal + 6, 323);
    ctx.closePath();
    ctx.fill();
    this.star(ctx, goal + 22, 306, 7, '#f8f6c4', '#287f7b');
    this.runner(ctx, x, y, state?.direction ?? 1, !!state?.grounded, time);
    ctx.restore();
    ctx.fillStyle = '#14283a';
    ctx.font = '600 12px system-ui, sans-serif';
    const label = palette.name.toUpperCase();
    ctx.fillStyle = index === 2 ? '#eef2ff' : '#243c4c';
    ctx.fillText(label, 22, HEIGHT - 20);
  }

  runner(ctx, x, y, direction, grounded, time) {
    ctx.save();
    ctx.translate(x + 12, y);
    if (direction < 0) ctx.scale(-1, 1);
    const stride = this.active && direction && grounded ? Math.round(Math.sin(time / 70) * 3) : 0;
    // Original orange flight suit, blue visor, and violet boots; no borrowed sprites.
    ctx.fillStyle = '#29384b';
    ctx.fillRect(-8, 0, 17, 12);
    ctx.fillStyle = '#ffc882';
    ctx.fillRect(-6, 1, 13, 9);
    ctx.fillStyle = '#a5e6ec';
    ctx.fillRect(-1, 3, 10, 5);
    ctx.fillStyle = '#267387';
    ctx.fillRect(3, 5, 6, 3);
    ctx.fillStyle = '#e47446';
    ctx.fillRect(-8, 11, 16, 12);
    ctx.fillStyle = '#ffc16c';
    ctx.fillRect(-5, 12, 6, 9);
    ctx.fillStyle = '#334760';
    ctx.fillRect(-10, 12, 4, 10);
    ctx.fillStyle = '#f7d6a2';
    ctx.fillRect(8, 17, 4, 5);
    ctx.fillStyle = '#473c65';
    ctx.fillRect(-8, 23, 7, 7 - Math.max(0, stride));
    ctx.fillRect(2, 23, 7, 7 - Math.max(0, -stride));
    ctx.fillStyle = '#c3a6d5';
    ctx.fillRect(-9, 27 - Math.max(0, stride), 9, 3);
    ctx.fillRect(2, 27 - Math.max(0, -stride), 10, 3);
    ctx.restore();
  }

  star(ctx, x, y, size, fill, outline) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const radius = i % 2 === 0 ? size : size * 0.48;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawHud(ctx) {
    ctx.fillStyle = '#122a3be8';
    ctx.fillRect(16, 16, 180, 45);
    ctx.fillStyle = '#9edfd4';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText('SERVER-VERIFIED RUN', 29, 32);
    ctx.fillStyle = '#fff8e4';
    ctx.font = '800 19px system-ui, sans-serif';
    ctx.fillText(this.view?.started ? `SCORE  ${this.view.score}` : 'READY TO PLAY', 29, 51);
    if (this.variant === 'platformer') {
      ctx.fillStyle = '#122a3be8';
      ctx.fillRect(662, 16, 122, 45);
      ctx.fillStyle = '#9edfd4';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.fillText('LEVEL', 676, 32);
      ctx.fillStyle = '#fff8e4';
      ctx.font = '800 19px system-ui, sans-serif';
      ctx.fillText(`${(this.view?.platform.level ?? 0) + 1}/3`, 676, 51);
    }
  }

  drawOverlay(ctx, finished) {
    ctx.fillStyle = '#10293675';
    ctx.fillRect(0, 76, WIDTH, 290);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d4f2d9';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(finished ? 'RUN FINISHED · SERVER-VERIFIED' : 'THE STUDIO ARCADE', WIDTH / 2, 144);
    ctx.fillStyle = '#fff8e5';
    ctx.font = '900 47px system-ui, sans-serif';
    const title = finished
      ? (this.view.outcome === 'complete' ? 'Route complete!' : this.view.outcome === 'timeout' ? 'Time’s up!' : 'Nice run!')
      : this.variant === 'flappy-bird' ? 'Sky Hopper' : 'Star Runner';
    ctx.fillText(title, WIDTH / 2, 205);
    ctx.font = '500 17px system-ui, sans-serif';
    const subtitle = finished
      ? `Final score: ${this.view.score}`
      : this.variant === 'flappy-bird' ? 'Small wings. Big sky. Find your rhythm.' : 'Three worlds. One bright little adventure.';
    ctx.fillText(subtitle, WIDTH / 2, 243);
    ctx.fillStyle = '#fff3c4';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillText(finished ? 'Use Play below for another run.' : 'Choose Play below to begin · 1 credit per play', WIDTH / 2, 291);
    ctx.fillStyle = '#d8eee7';
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillText(finished ? 'Only the server records your result.' : 'Preview only · No play starts until you choose Play', WIDTH / 2, 320);
    ctx.textAlign = 'left';
  }
}
