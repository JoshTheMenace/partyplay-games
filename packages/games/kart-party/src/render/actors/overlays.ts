/* Screen/world overlays that are cheap to draw for everyone: blob contact shadows (one instanced draw),
 * screen-space speed lines (one draw, per viewport intensity) and name tags (sprites, split views only). */
import * as THREE from 'three';

/* ---------- blob shadows ---------- */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly m = new THREE.Matrix4(); private readonly q = new THREE.Quaternion(); private readonly p = new THREE.Vector3(); private readonly s = new THREE.Vector3();
  private readonly down = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  constructor(capacity: number) {
    const material = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; varying float vA; attribute float aAlpha;
        void main() { vUv = uv * 2.0 - 1.0; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vA; void main() { float r = length(vUv); float a = smoothstep(1.0, 0.25, r) * vA; if (a < 0.01) discard; gl_FragColor = vec4(0.02, 0.02, 0.04, a); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.InstancedMesh(g, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; this.mesh.count = 0;
  }
  begin() { this.n = 0; }
  /** Add a shadow on the ground at (x, groundY, z); `height` above the ground fades and grows it. */
  add(x: number, groundY: number, z: number, width: number, length: number, yaw: number, height: number, normal?: THREE.Vector3, alpha = 1) {
    if (this.n >= this.mesh.instanceMatrix.count || width <= 0) return;
    const fade = Math.max(0, 1 - height / 14), grow = 1 + height * .06;
    if (normal) this.q.setFromUnitVectors(UP, normal); else this.q.identity();
    this.q.multiply(Q_YAW.setFromAxisAngle(UP, yaw)).multiply(this.down);
    this.m.compose(this.p.set(x, groundY + .04, z), this.q, this.s.set(width * grow, length * grow, 1));
    this.mesh.setMatrixAt(this.n, this.m);
    (this.mesh.geometry.getAttribute('aAlpha').array as Float32Array)[this.n] = .55 * fade * alpha;
    this.n++;
  }
  end() {
    this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true;
    const a = this.mesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute; a.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}
const UP = new THREE.Vector3(0, 1, 0), Q_YAW = new THREE.Quaternion();

/* ---------- speed lines (screen space, drawn after the scene in the current viewport) ---------- */
export class SpeedLines {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  constructor(count: number) {
    const g = new THREE.InstancedBufferGeometry(), quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) seed.set([(i / count) * Math.PI * 2 + Math.random() * .25, .9 + Math.random() * 1.2, Math.random(), .18 + Math.random() * .35], i * 4);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = count;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uAspect: { value: 1 } },
      vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform float uIntensity; uniform float uAspect; varying float vA; varying float vAlong;
        void main() { float t = fract(uTime * aSeed.y + aSeed.z); float r = mix(0.75, 1.6, t);
          float len = aSeed.w * (0.5 + 0.7 * uIntensity); vec2 dir = vec2(cos(aSeed.x), sin(aSeed.x)); vec2 perp = vec2(dir.y, -dir.x);   // (perp, dir) keeps front-facing winding
          float along = r + position.y * len; vAlong = position.y + 0.5;
          vec2 p = dir * along + perp * position.x * 0.0035 * (1.0 + along * 1.6);
          p.x /= uAspect; p.y *= 1.0;
          vA = uIntensity * sin(3.14159 * t) * (0.55 + 0.45 * fract(aSeed.z * 7.13)) * mix(1.0, 0.35, smoothstep(0.2, 0.9, dir.y));   // lighter over the sky
          gl_Position = vec4(p * vec2(1.0, 1.0) * 1.0, 0.0, 1.0); }`,
      fragmentShader: `varying float vA; varying float vAlong; void main() { float a = vA * smoothstep(0.0, 0.5, vAlong) * smoothstep(1.0, 0.7, vAlong) * 0.4; if (a < 0.004) discard; gl_FragColor = vec4(vec3(1.0), a); }`,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1000; this.mesh.visible = false; this.mesh.matrixAutoUpdate = false;
  }
  set(intensity: number, aspect: number, time: number) {
    this.mesh.visible = intensity > .02;
    this.material.uniforms.uIntensity.value = intensity; this.material.uniforms.uAspect.value = aspect; this.material.uniforms.uTime.value = time;
  }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/* ---------- name tags ---------- */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial; private texture: THREE.CanvasTexture | null = null;
  private label = '';
  /** Pill width as a fraction of the sprite width (for de-overlapping tags on screen). */
  width = .5;
  constructor() {
    this.material = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    this.sprite = new THREE.Sprite(this.material); this.sprite.renderOrder = 999; this.sprite.visible = false; this.sprite.center.set(.5, 0); this.sprite.scale.set(.34, .085, 1);   // ~6% of the viewport height
  }
  /** Redraw only when the text/colour changes. */
  set(name: string, color: string, rank: number) {
    const label = `${rank}|${name}|${color}`;
    if (label === this.label || typeof document === 'undefined') return;
    this.label = label;
    const c = this.texture?.image as HTMLCanvasElement | undefined ?? document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, 256, 64);
    g.font = '800 30px system-ui, sans-serif';
    const text = name.length > 12 ? `${name.slice(0, 11)}…` : name, tw = Math.min(200, g.measureText(text).width), w = tw + 60, x0 = (256 - w) / 2;
    this.width = w / 256;
    g.fillStyle = 'rgba(12,14,24,.72)'; roundRect(g, x0, 8, w, 44, 22); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(x0 + 24, 30, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#10131c'; g.font = '900 16px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(rank), x0 + 24, 31);
    g.fillStyle = '#fff'; g.font = '800 30px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(text, x0 + 44, 31, 200);
    // Pointer under the pill.
    g.fillStyle = 'rgba(12,14,24,.72)'; g.beginPath(); g.moveTo(118, 52); g.lineTo(138, 52); g.lineTo(128, 62); g.fill();
    if (!this.texture) { this.texture = new THREE.CanvasTexture(c); this.texture.colorSpace = THREE.SRGBColorSpace; this.material.map = this.texture; this.material.needsUpdate = true; }
    else this.texture.needsUpdate = true;
  }
  /** `lift` raises the tag by that many tag heights (stacking above a nearer tag). */
  place(x: number, y: number, z: number, opacity: number, lift = 0) {
    this.sprite.position.set(x, y, z); this.sprite.center.y = -lift; this.sprite.updateMatrixWorld(); this.material.opacity = opacity; this.sprite.visible = opacity > .02 && !!this.texture;
  }
  dispose() { this.texture?.dispose(); this.material.dispose(); this.sprite.removeFromParent(); }
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Screen-space de-overlap for name tags. Add tags nearest first as (x, y, half-width) in NDC; solve()
 * gives each the lowest of `maxRows` stacked rows (row height h) clear of every tag before it, or -1 (hide). */
export class TagStack {
  readonly x = new Float32Array(64); readonly y = new Float32Array(64); readonly hw = new Float32Array(64); readonly row = new Int8Array(64);
  n = 0;
  add(x: number, y: number, hw: number) { if (this.n < 64) { this.x[this.n] = x; this.y[this.n] = y; this.hw[this.n++] = hw; } }
  solve(h: number, maxRows = 3) {
    for (let i = 0; i < this.n; i++) {
      let row = 0;
      for (let j = 0; j < i && row < maxRows; j++) {
        if (this.row[j] >= 0 && Math.abs(this.x[i] - this.x[j]) < this.hw[i] + this.hw[j] && Math.abs(this.y[i] + row * h - this.y[j] - this.row[j] * h) < h) { row++; j = -1; }
      }
      this.row[i] = row < maxRows ? row : -1;
    }
  }
}
