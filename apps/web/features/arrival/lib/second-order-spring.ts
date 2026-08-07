// Second-order (spring) smoothing for pointer input, ported from the oryzo.ai
// input layer. `f` is the natural frequency in Hz, `z` the damping ratio (below
// 1 overshoots — that overshoot is the whole point for a breeze), `r` how much
// the spring anticipates the target's own velocity.
//
// The stable-coefficient recompute is the robust branch of the original: it
// rewrites k1/k2 per frame from the real frame time, so the spring cannot blow
// up when a tab stalls and hands back a 200ms delta.

export class SecondOrderSpring2 {
  readonly value = { x: 0, y: 0 };
  readonly velocity = { x: 0, y: 0 };

  private readonly target = { x: 0, y: 0 };
  private readonly prevTarget = { x: 0, y: 0 };
  private k1 = 0;
  private k2 = 0;
  private k3 = 0;
  private w = 0;
  private z = 0;
  private d = 0;

  constructor(f = 1, z = 0.3, r = 2) {
    const w = Math.PI * 2 * f;
    this.w = w;
    this.z = z;
    this.d = w * Math.sqrt(Math.abs(z * z - 1));
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / (w * w);
    this.k3 = (r * z) / w;
  }

  setTarget(x: number, y: number): void {
    this.target.x = x;
    this.target.y = y;
  }

  update(dt: number): void {
    if (dt <= 0) return;

    const targetVelX = (this.target.x - this.prevTarget.x) / dt;
    const targetVelY = (this.target.y - this.prevTarget.y) / dt;
    this.prevTarget.x = this.target.x;
    this.prevTarget.y = this.target.y;

    let k1 = this.k1;
    let k2 = this.k2;
    if (this.w * dt < this.z) {
      k2 = Math.max(k2, (dt * dt) / 2 + (dt * k1) / 2, dt * k1);
    } else {
      const decay = Math.exp(-this.z * this.w * dt);
      const carrier =
        2 *
        decay *
        (this.z <= 1 ? Math.cos(dt * this.d) : Math.cosh(dt * this.d));
      const decay2 = decay * decay;
      const scale = dt / (1 + decay2 - carrier);
      k1 = (1 - decay2) * scale;
      k2 = dt * scale;
    }

    this.value.x += this.velocity.x * dt;
    this.value.y += this.velocity.y * dt;
    this.velocity.x +=
      ((this.target.x +
        this.k3 * targetVelX -
        this.value.x -
        k1 * this.velocity.x) *
        dt) /
      k2;
    this.velocity.y +=
      ((this.target.y +
        this.k3 * targetVelY -
        this.value.y -
        k1 * this.velocity.y) *
        dt) /
      k2;
  }
}
