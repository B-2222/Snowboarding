// Keyboard, gamepad and touch input folded into one frame state.
import { clamp } from './util.js';

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  constructor(touchRoot) {
    this.down = new Set();
    this.pressedKeys = new Set();
    this.touch = { sx: 0, sy: 0, gx: 0, gy: 0, jump: false, tweak: false, active: false };
    this.touchPressed = new Set();
    this.padPrev = [];
    this.lastDevice = 'keyboard';
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedKeys.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    if (touchRoot) this.buildTouch(touchRoot);
  }

  key(...codes) {
    return codes.some((c) => this.down.has(c));
  }
  keyPressed(...codes) {
    return codes.some((c) => this.pressedKeys.has(c));
  }

  buildTouch(root) {
    this.touchRoot = root;
    const stick = (cls, label, onMove) => {
      const zone = document.createElement('div');
      zone.className = `touch-stick ${cls}`;
      zone.innerHTML = `<div class="touch-knob"></div><span>${label}</span>`;
      root.appendChild(zone);
      const knob = zone.firstChild;
      let id = null;
      let cx = 0, cy = 0;
      const R = 46;
      const move = (e) => {
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const l = Math.hypot(dx, dy);
        const k = l > R ? R / l : 1;
        knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        onMove(clamp(dx / R, -1, 1), clamp(-dy / R, -1, 1));
      };
      zone.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        id = e.pointerId;
        zone.setPointerCapture(id);
        const r = zone.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        move(e);
        this.touch.active = true;
        this.lastDevice = 'touch';
      });
      zone.addEventListener('pointermove', (e) => {
        if (e.pointerId === id) move(e);
      });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        knob.style.transform = '';
        onMove(0, 0);
      };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
    };
    stick('left', 'CARVE · SPIN · FLIP', (x, y) => {
      this.touch.sx = x;
      this.touch.sy = y;
    });
    stick('right', 'GRAB', (x, y) => {
      this.touch.gx = x;
      this.touch.gy = y;
    });
    const button = (cls, label, onDown, onUp) => {
      const b = document.createElement('button');
      b.className = `touch-btn ${cls}`;
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('on');
        this.touch.active = true;
        onDown();
        this.lastDevice = 'touch';
      });
      const up = () => {
        b.classList.remove('on');
        onUp && onUp();
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      root.appendChild(b);
      return b;
    };
    button('jump', 'JUMP', () => { this.touch.jump = true; this.touchPressed.add('jump'); }, () => (this.touch.jump = false));
    button('tweak', 'TWEAK', () => (this.touch.tweak = true), () => (this.touch.tweak = false));
    button('reset', 'RESET', () => this.touchPressed.add('reset'));
    button('cam', 'CAM', () => this.touchPressed.add('camera'));
    button('replay', 'REPLAY', () => this.touchPressed.add('replay'));
    button('pause', 'II', () => this.touchPressed.add('pause'));
  }

  // Read everything for this frame.
  poll(settings = {}) {
    const k = this.key.bind(this);
    let steer = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    let lean = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    let grabX = (k('ArrowRight', 'KeyL') ? 1 : 0) - (k('ArrowLeft', 'KeyJ') ? 1 : 0);
    let grabY = (k('ArrowUp', 'KeyI') ? 1 : 0) - (k('ArrowDown', 'KeyK') ? 1 : 0);
    let jump = k('Space');
    let tweak = k('ShiftLeft', 'ShiftRight');
    const act = {
      pause: this.keyPressed('Escape', 'KeyP'),
      camera: this.keyPressed('KeyC'),
      replay: this.keyPressed('KeyV'),
      reset: this.keyPressed('KeyR'),
      map: this.keyPressed('KeyM'),
      help: this.keyPressed('KeyH'),
      confirm: this.keyPressed('Enter'),
      jumpPressed: this.keyPressed('Space'),
    };
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
      const rx = dz(p.axes[2] || 0), ry = dz(p.axes[3] || 0);
      const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const prev = this.padPrev[p.index] || [];
      const pressed = (i) => b(i) && !prev[i];
      if (lx || ly || rx || ry || p.buttons.some((x) => x.pressed)) this.lastDevice = 'gamepad';
      if (lx) steer = lx;
      if (ly) lean = -ly;
      if (rx || ry) { grabX = rx; grabY = -ry; }
      if (b(12)) grabY = 1;
      if (b(13)) grabY = -1;
      if (b(14)) grabX = -1;
      if (b(15)) grabX = 1;
      jump = jump || b(0);
      tweak = tweak || b(5) || b(7);
      if (b(6)) lean = Math.max(lean, 1);
      if (b(1)) lean = Math.min(lean, -1);
      act.pause ||= pressed(9);
      act.camera ||= pressed(8) || pressed(4);
      act.replay ||= pressed(2);
      act.reset ||= pressed(3);
      act.confirm ||= pressed(0);
      act.jumpPressed ||= pressed(0);
      this.padPrev[p.index] = p.buttons.map((x) => x.pressed);
    }
    // touch
    const t = this.touch;
    if (t.active) {
      if (Math.abs(t.sx) > 0.15) steer = t.sx;
      if (Math.abs(t.sy) > 0.3) lean = t.sy;
      if (Math.abs(t.gx) > 0.3 || Math.abs(t.gy) > 0.3) { grabX = t.gx; grabY = t.gy; }
      jump = jump || t.jump;
      tweak = tweak || t.tweak;
      act.jumpPressed ||= this.touchPressed.has('jump');
      act.pause ||= this.touchPressed.has('pause');
      act.camera ||= this.touchPressed.has('camera');
      act.replay ||= this.touchPressed.has('replay');
      act.reset ||= this.touchPressed.has('reset');
    }
    return {
      steer: clamp(steer, -1, 1),
      lean: clamp(lean, -1, 1),
      jump,
      jumpPressed: act.jumpPressed,
      grabX,
      grabY,
      tweak,
      invertFlip: !!settings.invertFlip,
      act,
    };
  }

  endFrame() {
    this.pressedKeys.clear();
    this.touchPressed.clear();
  }

  anyKey() {
    return this.pressedKeys.size > 0;
  }
}
