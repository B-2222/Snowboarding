// A 1D height profile built from segments whose slope changes linearly.
// Each segment is [length, endSlope]; the profile starts at slope `startSlope`
// and height 0. Linear slope gives quadratic height, so the curve is C1 smooth
// unless a segment is tiny on purpose (for crisp lips).

export class Profile1D {
  constructor(segments, startSlope = 0) {
    this.u0 = [];
    this.len = [];
    this.s0 = [];
    this.s1 = [];
    this.h0 = [];
    let u = 0;
    let h = 0;
    let s = startSlope;
    for (const [L, sEnd] of segments) {
      if (L <= 0) continue;
      this.u0.push(u);
      this.len.push(L);
      this.s0.push(s);
      this.s1.push(sEnd);
      this.h0.push(h);
      h += (L * (s + sEnd)) / 2;
      u += L;
      s = sEnd;
    }
    this.length = u;
    this.endHeight = h;
    this.endSlope = s;
  }

  // Height at u (clamped: 0 before start, endHeight after end).
  height(u) {
    if (u <= 0) return 0;
    if (u >= this.length) return this.endHeight;
    // segments are few; linear scan is fine
    let i = this.u0.length - 1;
    for (let k = 0; k < this.u0.length; k++) {
      if (u < this.u0[k] + this.len[k]) { i = k; break; }
    }
    const t = u - this.u0[i];
    const L = this.len[i];
    const s0 = this.s0[i];
    const ds = (this.s1[i] - s0) / L;
    return this.h0[i] + s0 * t + 0.5 * ds * t * t;
  }

  slope(u) {
    if (u <= 0 || u >= this.length) return 0;
    for (let k = 0; k < this.u0.length; k++) {
      if (u < this.u0[k] + this.len[k]) {
        const t = (u - this.u0[k]) / this.len[k];
        return this.s0[k] + (this.s1[k] - this.s0[k]) * t;
      }
    }
    return 0;
  }

  // Find u of the first local maximum after `from` (used to locate lips).
  findSegmentEnd(index) {
    return this.u0[index] + this.len[index];
  }
}
