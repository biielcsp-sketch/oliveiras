// Oli em 3D (versão aprovada no protótipo, recolorida no azul do app): robô preto espelhado com neon azul, olhos em anel,
// folha de oliveira no topo e universo digital ao fundo.
// Arrastar gira o robô (ele volta a olhar de frente); tocar nas partes faz o Oli reagir.
// Este módulo só é carregado por import() dinâmico depois da primeira pintura (three fica em chunk próprio).
import * as THREE from "three";

const TAU = Math.PI * 2;

export type OliState = "idle" | "listen" | "think" | "speak";
export type Oli3D = {
  setState(s: OliState): void;
  setLevel(v: number): void;
  dispose(): void;
};

type Spring = { x: number; v: number };
type Ellipse = { cx: number; cy: number; rx: number; ry: number; rz: number };
type NeonSet = {
  base: THREE.Color;
  cur: THREE.Color;
  core: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
};

export async function createOli3D(container: HTMLElement, opts: { scenery?: boolean } = {}): Promise<Oli3D> {
  const textures: THREE.Texture[] = [];
  const track = <T extends THREE.Texture>(t: T) => {
    textures.push(t);
    return t;
  };

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab;outline:none";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Oli, o assistente da família. Arraste para girar, toque para interagir.");
  container.appendChild(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch (e) {
    canvas.remove();
    throw e;
  }
  // Resolução adaptativa: começa em até 2x e baixa se o aparelho não der conta (ver frame()).
  const PIXEL_STEPS = [2, 1.5, 1, 0.75, 0.5].filter((r) => r <= Math.min(window.devicePixelRatio || 1, 2));
  if (PIXEL_STEPS.length === 0) PIXEL_STEPS.push(Math.max(0.5, window.devicePixelRatio || 1));
  let pixelStep = 0;
  renderer.setPixelRatio(PIXEL_STEPS[0]);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 0.3, 8.4);
  camera.lookAt(0, -0.05, 0);

  const add = THREE.AdditiveBlending;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  let envTarget: THREE.WebGLRenderTarget | null = null;
  // ---------- ambiente de reflexo (caixas de luz) para o brilho do verniz ----------
  try {
    const ec = document.createElement("canvas");
    ec.width = 512; ec.height = 256;
    const g = ec.getContext("2d")!;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#eaf4fb"); grd.addColorStop(0.45, "#13202b"); grd.addColorStop(1, "#030609");
    g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
    g.fillStyle = "#ffffff";
    [[30, 36, 210, 74], [290, 26, 180, 60], [446, 70, 38, 130], [190, 120, 50, 26]].forEach((r) => g.fillRect(r[0], r[1], r[2], r[3]));
    g.fillStyle = "#3fa6da"; g.fillRect(120, 150, 110, 30);
    g.fillStyle = "#9fdcff"; g.fillRect(330, 130, 90, 40);
    g.fillStyle = "#1a79a8"; g.fillRect(6, 104, 44, 70);
    const envTex = new THREE.CanvasTexture(ec);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(renderer);
    envTarget = pm.fromEquirectangular(envTex);
    scene.environment = envTarget.texture;
    envTex.dispose(); pm.dispose();
  } catch (e) { console.warn("Sem ambiente de reflexo:", e); }

  // ---------- luzes ----------
  scene.add(new THREE.AmbientLight(0x8fa6b8, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(2.5, 3.5, 5);
  scene.add(key);
  const rimL = new THREE.PointLight(0x7fcdf5, 22, 14, 1.5);
  rimL.position.set(-4, 1.5, -2.5);
  scene.add(rimL);
  const rimR = new THREE.PointLight(0xd7eefa, 22, 14, 1.5);
  rimR.position.set(4, 0.5, -2.5);
  scene.add(rimR);

  // ---------- geometria do corpo (para colar as linhas na superfície) ----------
  const BODY = { rx: 1, ry: 1, rz: 0.95 };
  const PODS = [-1, 1].map((s) => ({
    s,
    big: { cx: s * 1.06, cy: -0.2, rx: 0.26, ry: 0.5, rz: 0.4 },
    cap: { cx: s * 1.2, cy: -0.2, rx: 0.14, ry: 0.36, rz: 0.3 },
  }));
  const ez = (e: Ellipse, x: number, y: number) => { const q = 1 - ((x - e.cx) / e.rx) ** 2 - ((y - e.cy) / e.ry) ** 2; return q > 0 ? e.rz * Math.sqrt(q) : 0; };
  function zS(x: number, y: number) {
    let z = BODY.rz * Math.sqrt(Math.max(0, 1 - (x / BODY.rx) ** 2 - (y / BODY.ry) ** 2));
    for (const p of PODS) z = Math.max(z, ez(p.big, x, y), ez(p.cap, x, y));
    return z;
  }
  function placeOnSurface(obj: THREE.Object3D, x: number, y: number, off: number) {
    const z = zS(x, y) + off;
    obj.position.set(x, y, z);
    const n = new THREE.Vector3(x / BODY.rx ** 2, y / BODY.ry ** 2, z / BODY.rz ** 2).normalize();
    obj.lookAt(x + n.x, y + n.y, z + n.z);
  }
  function chaikin(p: number[][], it: number) {
    for (let k = 0; k < it; k++) {
      const q: number[][] = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      q.push(p[p.length - 1]);
      p = q;
    }
    return p;
  }
  function resample(p: number[][], n: number) {
    const L = [0];
    for (let i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    const tot = L[L.length - 1],
      out: number[][] = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = (i / (n - 1)) * tot;
      while (j < L.length - 2 && L[j + 1] < d) j++;
      const f = (d - L[j]) / (L[j + 1] - L[j] || 1);
      out.push([p[j][0] + (p[j + 1][0] - p[j][0]) * f, p[j][1] + (p[j + 1][1] - p[j][1]) * f]);
    }
    return out;
  }

  // ---------- materiais ----------
  // textura de metal líquido: ondulações suaves que deformam os reflexos
  const waveCv = document.createElement("canvas");
  waveCv.width = 512; waveCv.height = 256;
  (function () {
    const g = waveCv.getContext("2d")!;
    g.fillStyle = "#808080"; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 70; i++) {
      const x = rnd(0, 512), y = rnd(0, 256), r = rnd(20, 70), l = Math.random() < 0.5 ? 255 : 0;
      for (const dx of [-512, 0, 512]) {
        const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        gr.addColorStop(0, `rgba(${l},${l},${l},.35)`); gr.addColorStop(1, `rgba(${l},${l},${l},0)`);
        g.fillStyle = gr; g.fillRect(x + dx - r, y - r, r * 2, r * 2);
      }
    }
  })();
  const waveTex = track(new THREE.CanvasTexture(waveCv));
  waveTex.wrapS = THREE.RepeatWrapping;

  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x040506, roughness: 0.1, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.4, bumpMap: waveTex, bumpScale: 1.2 });
  const accentMat = new THREE.MeshPhysicalMaterial({ color: 0xdce5ec, roughness: 0.12, metalness: 1, envMapIntensity: 2, side: THREE.DoubleSide });
  const btnMat = new THREE.MeshPhysicalMaterial({ color: 0x08121a, roughness: 0.1, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 2 });
  // três grupos de neon em tons do azul do app
  const mkSet = (c: number): NeonSet => ({
    base: new THREE.Color(c), cur: new THREE.Color(c),
    core: new THREE.MeshBasicMaterial({ color: c, toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, blending: add, depthWrite: false, toneMapped: false }),
  });
  const setEye = mkSet(0x9fdcff), setMouth = mkSet(0x3fa6da), setEar = mkSet(0xc8ecff);
  const neonSets = [setEye, setMouth, setEar];
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x06243a, emissive: 0x3fa6da, emissiveIntensity: 0.8, roughness: 0.2, metalness: 0.1 });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  function glyphDot() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 62);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(255,255,255,.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const dotTex = glyphDot();

  function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 8 });
    g.translate(0, 0, -d / 2);
    return new THREE.Mesh(g, mat);
  }
  function neon(pts: THREE.Vector3[], closed: boolean, r = 0.024, set = setEye) {
    const curve = new THREE.CatmullRomCurve3(pts, closed, "catmullrom", 0.3);
    const seg = Math.max(32, pts.length * 3);
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 8, closed), set.core));
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r * 3.4, 8, closed), set.glow));
    return grp;
  }

  // ---------- grupos ----------
  const root = new THREE.Group(); // flutua, pula e amassa
  scene.add(root);
  const bot = new THREE.Group(); // gira e inclina
  root.add(bot);

  // corpo
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), bodyMat);
  body.scale.set(BODY.rx, BODY.ry, BODY.rz);
  body.userData.kind = "body";
  bot.add(body);

  // orelhas laterais (com arco de neon na borda)
  const ears: Record<number, THREE.Group> = {};
  PODS.forEach((p) => {
    const eg = new THREE.Group();
    const big = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), bodyMat);
    big.scale.set(p.big.rx, p.big.ry, p.big.rz);
    big.position.set(p.big.cx, p.big.cy, 0);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), bodyMat);
    cap.scale.set(p.cap.rx, p.cap.ry, p.cap.rz);
    cap.position.set(p.cap.cx, p.cap.cy, 0);
    big.userData.kind = cap.userData.kind = p.s < 0 ? "earL" : "earR";
    eg.add(big, cap);
    const arc: THREE.Vector3[] = [];
    for (let i = 0; i <= 28; i++) {
      const y = -0.6 + (i / 28) * 0.8;
      const x = p.s * (0.97 - 0.1 * (1 - ((y + 0.2) / 0.42) ** 2));
      arc.push(new THREE.Vector3(x, y, zS(x, y) + 0.025));
    }
    eg.add(neon(arc, false, 0.024, setEar));
    bot.add(eg);
    ears[p.s] = eg;
  });

  // boca / faixa do peito em zigue-zague
  const mouth2d = resample(chaikin([[-0.87, -0.36], [-0.45, -0.41], [-0.28, -0.26], [0.28, -0.26], [0.45, -0.41], [0.87, -0.36]], 2), 70);
  const mouth = neon(mouth2d.map(([x, y]) => new THREE.Vector3(x, y, zS(x, y) + 0.03)), false, 0.026, setMouth);
  bot.add(mouth);

  // borda de vidro: brilho azul nas bordas do corpo
  const rimMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x7fcdf5) }, uInt: { value: 0.8 } },
    vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
    fragmentShader: "uniform vec3 uColor; uniform float uInt; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); gl_FragColor = vec4(uColor * f * uInt, f * uInt); }",
    transparent: true, depthWrite: false, blending: add,
  });
  const rimShell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), rimMat);
  rimShell.scale.set(BODY.rx * 1.045, BODY.ry * 1.045, BODY.rz * 1.045);
  bot.add(rimShell);

  // testeira escura sobre os olhos
  const brow2d = resample(chaikin([[-0.72, 0.12], [-0.66, 0.3], [-0.5, 0.38], [0, 0.4], [0.5, 0.38], [0.66, 0.3], [0.72, 0.12]], 2), 50);
  const brow = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(brow2d.map(([x, y]) => new THREE.Vector3(x, y, zS(x, y) + 0.012)), false, "catmullrom", 0.3), 80, 0.018, 8, false),
    accentMat,
  );
  bot.add(brow);

  // olhos: anel de neon + pupila branca que segue o dedo
  const eyes: { g: THREE.Group; pupil: THREE.Mesh; hit: THREE.Mesh }[] = [];
  [-1, 1].forEach((s) => {
    const g = new THREE.Group();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * 0.135, Math.sin(a) * 0.25, 0)); }
    g.add(neon(pts, true, 0.022));
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    pupil.scale.set(0.055, 0.08, 1);
    pupil.position.z = 0.004;
    g.add(pupil);
    const hit = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), hitMat);
    hit.scale.set(0.7, 1.1, 1);
    hit.userData.kind = "eye";
    g.add(hit);
    placeOnSurface(g, s * 0.42, 0.04, 0.03);
    bot.add(g);
    eyes.push({ g, pupil, hit });
  });

  const chev = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.16, 0.16); s.lineTo(0.16, 0.16); s.lineTo(0.16, 0); s.lineTo(0, -0.17); s.lineTo(-0.16, 0); s.lineTo(-0.16, 0.16);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
    g.translate(0, 0, -0.035);
    const m = new THREE.Mesh(g, accentMat);
    placeOnSurface(m, 0, 0.62, -0.01);
    m.userData.kind = "ant";
    return m;
  })();
  bot.add(chev);

  // folha de oliveira: alongada, verde-prata (identidade do nome), com nervura de neon azul (nasce no topo da cabeça)
  const leafMat = new THREE.MeshPhysicalMaterial({ color: 0x5f9a58, roughness: 0.28, metalness: 0.55, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 1.8, side: THREE.DoubleSide });
  const bendX = (y: number) => 0.3 * y * y;
  const leaf = new THREE.Group();
  leaf.position.set(0, 0.96, -0.02);
  {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.bezierCurveTo(0.2, 0.12, 0.2, 0.62, 0, 1.05);
    sh.bezierCurveTo(-0.2, 0.62, -0.2, 0.12, 0, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 24 });
    g.translate(0, 0, -0.01);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setX(i, pa.getX(i) + bendX(pa.getY(i)));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, leafMat);
    m.userData.kind = "ant";
    leaf.add(m);
    const rib: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) { const y = (i / 14) * 1.0; rib.push(new THREE.Vector3(bendX(y), y, 0.03)); }
    leaf.add(neon(rib, false, 0.014, setEye));
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 10), accentMat);
    st.position.set(0, -0.02, 0);
    leaf.add(st);
  }
  leaf.rotation.set(-0.12, 0, -0.18);
  bot.add(leaf);

  // botões do peito
  const btns: { g: THREE.Group; m: THREE.Mesh }[] = [];
  [-1, 1].forEach((s) => {
    const g = new THREE.Group();
    const m = rbox(0.3, 0.26, 0.06, 0.06, btnMat);
    m.userData.kind = s < 0 ? "btnL" : "btnR";
    g.add(m);
    placeOnSurface(g, s * 0.54, -0.62, -0.005);
    g.rotateZ(s * -0.15);
    bot.add(g);
    btns.push({ g, m });
  });

  // ---------- brilho de fundo e chão ----------
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0x4ba3d4, transparent: true, opacity: 0.32, depthWrite: false, blending: add }));
  halo.scale.set(26, 26, 1);
  halo.position.set(0, 0, -1.6);
  scene.add(halo);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48), new THREE.MeshBasicMaterial({ map: dotTex, color: 0x4ba3d4, transparent: true, opacity: 0.3, depthWrite: false, blending: add }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1.32, 0.1);
  floor.scale.set(1.5, 1.5, 1);
  scene.add(floor);

  // ---------- universo digital ao fundo (hologramas, dados, atmosfera) ----------
  const bg = new THREE.Group();
  scene.add(bg);
  const PAL = [0x3fa6da, 0x9fdcff, 0xc8ecff, 0x6cb8e8, 0xd7eefa, 0xffffff];
  const bgTint = new THREE.Color(0xffffff), bgTintAmber = new THREE.Color(0xffa860), bgTintNow = new THREE.Color(0xffffff);

  // névoas coloridas
  const nebulae: { sp: THREE.Sprite; ox: number; oy: number; o: number; ph: number }[] = [];
  [[-3.2, 1.6, -6, 14, 0x1a79a8, 0.3], [3.4, -1.2, -7, 15, 0x0f5c82, 0.28], [0.4, 2.4, -8, 16, 0x3fa6da, 0.2], [-2.2, -2.4, -6, 12, 0x0f5c82, 0.24], [2.8, 2.2, -7, 11, 0x1a79a8, 0.2], [-5, 0, -8, 14, 0x1a79a8, 0.22], [5, 0.4, -8, 14, 0x2a8cc0, 0.22], [0, -3.4, -6, 14, 0x0f5c82, 0.24], [0, 0.2, -9, 22, 0x15699a, 0.22]].forEach(([x, y, z, s, c, o]) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: c, transparent: true, opacity: o, depthWrite: false, blending: add }));
    sp.position.set(x, y, z); sp.scale.set(s, s, 1);
    bg.add(sp);
    nebulae.push({ sp, ox: x, oy: y, o, ph: rnd(0, 6.28) });
  });

  // poeira de estrelas / partículas de dados em duas profundidades
  function starField(n: number, spread: number, zmin: number, zmax: number, size: number, opacity: number) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos.set([rnd(-spread, spread), rnd(-spread * 0.75, spread * 0.75), rnd(zmin, zmax)], i * 3);
      c.setHex(PAL[Math.floor(Math.random() * PAL.length)]);
      const k = rnd(0.35, 1);
      col.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: dotTex, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: add, sizeAttenuation: true }));
    bg.add(pts);
    return pts;
  }
  const starFar = starField(260, 11, -13, -6, 0.17, 0.85);
  const starNear = starField(110, 6, -5, -1.8, 0.1, 0.9);

  // chuva de dígitos 0 e 1
  function glyphText(text: string) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.font = "bold 46px monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 32, 36);
    const t = track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const rains = [glyphText("0"), glyphText("1")].map((tex) => {
    const n = 55,
      pos = new Float32Array(n * 3),
      items: { x: number; y: number; z: number; v: number }[] = [];
    for (let i = 0; i < n; i++) items.push({ x: Math.round(rnd(-4.4, 4.4) / 0.35) * 0.35, y: rnd(-3.2, 3.2), z: rnd(-5.5, -2.6), v: rnd(0.3, 0.95) });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x6cb8e8, size: 0.27, map: tex, transparent: true, opacity: 0.5, depthWrite: false, blending: add }));
    bg.add(pts);
    return { pts, items, n };
  });

  // piso holográfico em grade com ondas de pulso
  const gridPts: number[] = [],
    GS = 0.7;
  for (let x = -8; x <= 8.001; x += GS) gridPts.push(x, 0, -10, x, 0, 2.5);
  for (let z = -10; z <= 2.501; z += GS) gridPts.push(-8, 0, z, 8, 0, z);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
  const gridMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x3fa6da) }, uInt: { value: 1 } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform float uTime; uniform vec3 uColor; uniform float uInt; varying vec3 vP; void main(){ float d = length(vP.xz); float fade = 1.0 - smoothstep(2.0, 8.5, d); float wave = exp(-pow((fract(d * 0.14 - uTime * 0.22) - 0.5) * 9.0, 2.0)); float a = fade * (0.3 + 0.9 * wave) * uInt; gl_FragColor = vec4(uColor * a, a); }",
    transparent: true, depthWrite: false, blending: add,
  });
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.position.y = -1.34;
  bg.add(grid);

  // anéis no chão, girando sob o robô
  const ringMats: (THREE.LineDashedMaterial | THREE.LineBasicMaterial)[] = [];
  const floorG = new THREE.Group();
  floorG.position.set(0, -1.31, 0.1);
  bg.add(floorG);
  const flat = (pts: number[][]) => pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const rings = [[1.35, 0.7, 0.16, 0.1, 0.55], [1.85, 0.5, 0.35, 0.18, -0.38], [2.4, 0.38, 0.1, 0.07, 0.25], [3.05, 0.26, 0.5, 0.25, -0.15]].map(([r, op, dash, gap, sp]) => {
    const pts: number[][] = [];
    for (let i = 0; i <= 160; i++) { const a = (i / 160) * TAU; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const mat = new THREE.LineDashedMaterial({ color: 0x9fdcff, transparent: true, opacity: op, dashSize: dash, gapSize: gap, blending: add, depthWrite: false });
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(flat(pts)), mat);
    ln.computeLineDistances();
    floorG.add(ln);
    ringMats.push(mat);
    return { ln, sp };
  });
  const tickPts: THREE.Vector3[] = [];
  for (let i = 0; i < 120; i++) { const a = (i / 120) * TAU, r1 = 3.35, r2 = i % 6 === 0 ? 3.6 : 3.47; tickPts.push(new THREE.Vector3(Math.cos(a) * r1, 0, Math.sin(a) * r1), new THREE.Vector3(Math.cos(a) * r2, 0, Math.sin(a) * r2)); }
  const ticks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), new THREE.LineBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.35, blending: add, depthWrite: false }));
  floorG.add(ticks);
  ringMats.push(ticks.material);

  // pixels quadrados à deriva (atmosfera de dados)
  const PXN = 260,
    pxPos = new Float32Array(PXN * 3),
    pxItems: { x: number; y: number; z: number; v: number; ph: number }[] = [];
  for (let i = 0; i < PXN; i++) pxItems.push({ x: rnd(-6.5, 6.5), y: rnd(-4.2, 4.2), z: rnd(-8, -1.5), v: rnd(0.05, 0.3), ph: rnd(0, 6.28) });
  const pxGeo = new THREE.BufferGeometry();
  pxGeo.setAttribute("position", new THREE.BufferAttribute(pxPos, 3));
  const pixels = new THREE.Points(pxGeo, new THREE.PointsMaterial({ color: 0xc8ecff, size: 0.075, transparent: true, opacity: 0.7, depthWrite: false, blending: add, sizeAttenuation: true }));
  bg.add(pixels);

  // faixa de varredura holográfica
  const scan = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0x6cb8e8, transparent: true, opacity: 0.1, depthWrite: false, blending: add }));
  scan.scale.set(11, 0.35, 1);
  scan.position.z = -2.4;
  bg.add(scan);

  // ---------- ondas de toque ----------
  const ripples: { m: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; t: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 64; j++) { const a = (j / 64) * TAU; pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
    const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: add }));
    m.visible = false;
    scene.add(m);
    ripples.push({ m, t: 1 });
  }
  function ripple(worldPos: THREE.Vector3) {
    const r = ripples.find((x) => x.t >= 1) || ripples[0];
    r.t = 0;
    r.m.position.copy(worldPos);
    r.m.quaternion.copy(camera.quaternion);
    r.m.visible = true;
  }

  // ---------- molas ----------
  const spring = (): Spring => ({ x: 0, v: 0 });
  const stepSpring = (s: Spring, dt: number, k: number, c: number) => { s.v += (-k * s.x - c * s.v) * dt; s.x += s.v * dt; };
  const sBody = spring(), sHop = spring(), sEye = spring(), sEarL = spring(), sEarR = spring(), sAnt = spring(), sBtnL = spring(), sBtnR = spring();

  // ---------- estado ----------
  let state: OliState = "idle",
    level = 0, lvlSm = 0, w = 1, h = 1;
  let yaw = 0, yawV = 0, dragging = false, lastX = 0, downY = 0, downT = 0, moved = 0, releaseT = 0;
  let lookX = 0, lookY = 0, tLookX = 0, tLookY = 0, lastPtr = 0, wanderAt = 0;
  let blinkT = -1, nextBlink = 2, flash = 0;
  const whiteC = new THREE.Color(0xffffff), amberC = new THREE.Color(0xff9a2a), tmpC = new THREE.Color();
  const haloIdle = new THREE.Color(0x4ba3d4), haloAmber = new THREE.Color(0xff9a2a);

  function resize() {
    const r = container.getBoundingClientRect();
    w = Math.max(160, Math.round(r.width));
    h = Math.max(160, Math.round(r.height || r.width));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 40 : 34;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // ---------- ponteiro ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const targets: THREE.Object3D[] = [];
  bot.traverse((o) => { if (o.userData && o.userData.kind) targets.push(o); });
  function setNdc(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  }
  function aimEye(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), ny = (e.clientY - (r.top + r.height * 0.5)) / (r.height / 2);
    const d = Math.hypot(nx, ny) || 1, m = Math.min(1, d);
    tLookX = (nx / d) * m * 0.17;
    tLookY = -(ny / d) * m * 0.15;
    lastPtr = performance.now();
  }
  function poke(e: PointerEvent) {
    setNdc(e);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) return;
    if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
    ripple(hit.point.clone());
    flash = 1;
    switch (hit.object.userData.kind) {
      case "eye": blinkT = 0; sEye.v -= 7; sBody.v -= 2; break;
      case "earL": sEarL.v += 16; sBody.v -= 1; break;
      case "earR": sEarR.v -= 16; sBody.v -= 1; break;
      case "ant": sAnt.v += 18; sHop.v += 2; break;
      case "btnL": sBtnL.v += 14; sBody.v -= 1.5; break;
      case "btnR": sBtnR.v += 14; sBody.v -= 1.5; break;
      default: sBody.v -= 5; sHop.v += 5; sEarL.v += 8; sEarR.v -= 8; sAnt.v += 8; blinkT = 0; yawV += (Math.random() < 0.5 ? -1 : 1) * 2.2;
    }
  }
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; moved = 0; lastX = e.clientX; downY = e.clientY; downT = performance.now(); yawV = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    canvas.style.cursor = "grabbing";
    aimEye(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    aimEye(e);
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx) + Math.abs(e.clientY - downY) * 0.2;
    yaw += dx * 0.012;
    yawV = dx * 0.012 * 60;
  });
  const up = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false; releaseT = performance.now();
    canvas.style.cursor = "grab";
    if (moved < 7 && performance.now() - downT < 400 && e.type === "pointerup") poke(e);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  const onWindowMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && !dragging) aimEye(e);
  };
  window.addEventListener("pointermove", onWindowMove, { passive: true });

  // ---------- laço de animação ----------
  const clock = new THREE.Clock();
  // Anima só quando o palco está visível na tela E a aba está ativa.
  let onScreen = true,
    disposed = false,
    raf = 0;
  const shouldRun = () => !disposed && onScreen && document.visibilityState === "visible";
  const kick = () => {
    if (shouldRun() && !raf) {
      clock.getDelta();
      raf = requestAnimationFrame(frame);
    }
  };
  const io = new IntersectionObserver((en) => {
    onScreen = en[0].isIntersecting;
    kick();
  });
  io.observe(container);
  document.addEventListener("visibilitychange", kick);

  // Aparelho fraco: se a média ficar abaixo de ~24 quadros/s, reduz a resolução do canvas
  // (o modelo e os efeitos continuam iguais; só a nitidez cai). No mínimo de resolução e ainda lento,
  // limita a 30, 15 e por fim 6 quadros/s (ex.: aparelho sem GPU) para não travar a página (rolagem, toques).
  const FRAME_CAPS = [0, 1 / 30, 1 / 15, 1 / 6];
  let capStep = 0,
    lastRender = 0,
    perfFrames = 0,
    perfTime = 0;
  function adaptQuality(rawDt: number) {
    if (rawDt > 1.5) return; // pausa longa (aba oculta): não conta
    if (clock.elapsedTime < 1.5) return; // aquecimento (compilação de shaders) não conta
    perfFrames++;
    perfTime += rawDt;
    if (perfTime < 0.5 || perfFrames < 2) return;
    const fps = perfFrames / perfTime;
    perfFrames = 0;
    perfTime = 0;
    const target = capStep === 0 ? 24 : 0.8 / FRAME_CAPS[capStep];
    if (fps >= target) return;
    const veryslow = fps < 12; // muito lento: pula direto para o último degrau
    if (pixelStep < PIXEL_STEPS.length - 1) {
      pixelStep = veryslow ? PIXEL_STEPS.length - 1 : pixelStep + 1;
      renderer.setPixelRatio(PIXEL_STEPS[pixelStep]);
      resize();
    } else if (capStep < FRAME_CAPS.length - 1) {
      capStep = veryslow ? FRAME_CAPS.length - 1 : capStep + 1;
    }
  }

  function frame() {
    raf = 0;
    if (!shouldRun()) return;
    const nowMs = performance.now();
    if (capStep > 0 && nowMs - lastRender < FRAME_CAPS[capStep] * 1000 - 4) {
      raf = requestAnimationFrame(frame);
      return;
    }
    lastRender = nowMs;
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05),
      t = clock.elapsedTime,
      now = performance.now();
    adaptQuality(rawDt);
    const thinking = state === "think", speaking = state === "speak", listening = state === "listen";

    lvlSm += (level - lvlSm) * Math.min(1, dt * 14);
    flash = Math.max(0, flash - dt * 1.6);

    // giro: arrasto com inércia; depois de soltar, volta a olhar de frente
    if (!dragging) {
      yaw += yawV * dt;
      yawV *= Math.exp(-dt * 3);
      if (now - releaseT > 900) { const tgt = Math.round(yaw / TAU) * TAU; yaw += (tgt - yaw) * Math.min(1, dt * 3.2); }
    }
    bot.rotation.y = yaw + Math.sin(t * 0.7) * 0.08 + lookX * 1.4;
    bot.rotation.x = -lookY * 0.8;

    // pulo, amassado e flutuação
    stepSpring(sHop, dt, 140, 9); stepSpring(sBody, dt, 110, 7); stepSpring(sEye, dt, 120, 7);
    root.position.y = Math.sin(t * 1.3) * 0.04 + Math.max(0, sHop.x) * 0.3 + (thinking ? Math.sin(t * 3) * 0.02 : 0);
    const breathe = 1 + (listening ? lvlSm * 0.03 : speaking ? lvlSm * 0.04 : 0) + Math.sin(t * 1.6) * 0.004;
    const sq = sBody.x;
    root.scale.set((1 - sq * 0.05) * breathe, (1 + sq * 0.08) * breathe, (1 - sq * 0.05) * breathe);

    // cor e brilho do neon
    const inten = (thinking ? 0.8 + 0.35 * Math.sin(t * 6) : speaking ? 1 + lvlSm * 1.1 : listening ? 1 + lvlSm * 0.8 : 1 + 0.06 * Math.sin(t * 1.6)) + flash * 0.9;
    neonSets.forEach((s) => {
      tmpC.copy(s.base);
      if (thinking) tmpC.copy(amberC); else if (speaking) tmpC.lerp(whiteC, 0.25 + lvlSm * 0.4);
      s.cur.lerp(tmpC, Math.min(1, dt * 6));
      s.core.color.copy(s.cur); s.glow.color.copy(s.cur);
      s.glow.opacity = Math.min(0.85, 0.2 * inten);
    });
    rimMat.uniforms.uInt.value = 0.7 + lvlSm * 0.8 + flash * 0.6;
    rimMat.uniforms.uColor.value.copy(thinking ? amberC : setMouth.cur);
    halo.material.color.lerp(thinking || speaking ? haloAmber : haloIdle, Math.min(1, dt * 5));
    halo.material.opacity += ((0.32 + lvlSm * 0.25 + flash * 0.2 + (thinking ? 0.05 * Math.sin(t * 6) : 0)) - halo.material.opacity) * Math.min(1, dt * 6);
    floor.material.opacity = 0.26 + lvlSm * 0.2 + flash * 0.15;
    rimL.intensity = 20 + lvlSm * 14 + flash * 10;
    rimR.intensity = 20 + lvlSm * 14 + flash * 10;
    screenMat.emissiveIntensity = 0.5 + (speaking ? lvlSm * 2 : 0) + (thinking ? 0.6 + 0.6 * Math.sin(t * 6) : 0) + flash;
    screenMat.emissive.setHex(thinking ? 0xc8701a : 0x3fa6da);

    // olhos: seguem o dedo, piscam, pupila reage
    if (now - lastPtr > 2500 && now > wanderAt) { tLookX = (Math.random() - 0.5) * 0.28; tLookY = (Math.random() - 0.5) * 0.2; wanderAt = now + 2200; }
    lookX += (tLookX - lookX) * Math.min(1, dt * 9);
    lookY += (tLookY - lookY) * Math.min(1, dt * 9);
    nextBlink -= dt;
    if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 3 + Math.random() * 2.5; }
    let lidY = 1;
    if (blinkT >= 0) { blinkT += dt; const k = blinkT / 0.2; lidY = k >= 1 ? 1 : 1 - Math.sin(Math.PI * k) * 0.9; if (k >= 1) blinkT = -1; }
    const ex = 1 + sEye.x * 0.1 + (listening ? lvlSm * 0.1 : 0);
    const ey = (thinking ? 0.88 : 1) * ex * lidY;
    let px = Math.max(-0.06, Math.min(0.06, lookX * 0.4)), py = Math.max(-0.1, Math.min(0.1, lookY * 0.6));
    if (thinking) { px = Math.cos(t * 3) * 0.04; py = Math.sin(t * 3) * 0.05; }
    const pk = (listening ? 1 + lvlSm * 0.5 : speaking ? 1 + lvlSm * 0.25 : 1) * (thinking ? 0.9 : 1);
    eyes.forEach((E) => { E.g.scale.set(ex, ey, 1); E.pupil.position.x = px; E.pupil.position.y = py; E.pupil.scale.set(0.055 * pk, 0.08 * pk, 1); });

    // orelhas, antena, botões
    stepSpring(sEarL, dt, 90, 5.5); stepSpring(sEarR, dt, 90, 5.5); stepSpring(sAnt, dt, 85, 4.5); stepSpring(sBtnL, dt, 160, 9); stepSpring(sBtnR, dt, 160, 9);
    const earPulse = speaking ? lvlSm * 0.06 : listening ? lvlSm * 0.05 : 0;
    ears[-1].rotation.y = -sEarL.x * 0.22 + Math.sin(t * 1.3) * 0.015;
    ears[1].rotation.y = -sEarR.x * 0.22 - Math.sin(t * 1.3 + 1) * 0.015;
    ears[-1].scale.set(1 + earPulse, 1 + earPulse, 1 + earPulse);
    ears[1].scale.set(1 + earPulse, 1 + earPulse, 1 + earPulse);
    const flap = thinking ? Math.sin(t * 5) * 0.08 : speaking ? Math.sin(t * 7) * 0.04 * (0.5 + lvlSm) : 0;
    leaf.rotation.z = -0.18 + sAnt.x * 0.18 + flap * 0.9 + Math.sin(t * 1.4) * 0.05;
    leaf.rotation.x = -0.12 + Math.sin(t * 1.1 + 1) * 0.03;
    btns[0].m.position.z = -Math.max(0, sBtnL.x) * 0.03;
    btns[1].m.position.z = -Math.max(0, sBtnR.x) * 0.03;

    // universo digital: paralaxe, deriva, pulso com a voz, cor muda ao pensar
    bg.rotation.y = lookX * 0.8 + yaw * 0.12 + Math.sin(t * 0.12) * 0.05;
    bg.position.x = -lookX * 0.8;
    bgTintNow.lerp(thinking ? bgTintAmber : bgTint, Math.min(1, dt * 4));
    const bgLvl = speaking || listening ? lvlSm : 0;
    starFar.rotation.y = t * 0.008; starNear.rotation.y = -t * 0.015; starFar.rotation.x = Math.sin(t * 0.05) * 0.03;
    starFar.material.color.copy(bgTintNow); starNear.material.color.copy(bgTintNow);
    starFar.material.opacity = 0.7 + bgLvl * 0.3 + flash * 0.2; starNear.material.opacity = 0.8 + bgLvl * 0.2;
    rains.forEach((R) => {
      const a = R.pts.geometry.attributes.position;
      for (let i = 0; i < R.n; i++) {
        const q = R.items[i];
        q.y -= q.v * dt * (1 + bgLvl * 2 + (thinking ? 1.2 : 0));
        if (q.y < -3.3) { q.y = 3.3; q.x = Math.round(rnd(-4.4, 4.4) / 0.35) * 0.35; }
        a.setXYZ(i, q.x, q.y, q.z);
      }
      a.needsUpdate = true;
      R.pts.material.color.set(thinking ? 0xffa860 : 0x6cb8e8);
      R.pts.material.opacity = 0.45 + bgLvl * 0.3;
    });
    gridMat.uniforms.uTime.value = t * (speaking ? 1.8 : thinking ? 1.4 : 1);
    gridMat.uniforms.uInt.value = 0.9 + bgLvl * 0.8 + flash * 0.5;
    gridMat.uniforms.uColor.value.lerp(thinking ? amberC : setMouth.base, Math.min(1, dt * 4));
    rings.forEach((R) => { R.ln.rotation.y += R.sp * dt * (thinking ? 3 : speaking ? 1.8 : 1); });
    ticks.rotation.y -= dt * 0.12 * (thinking ? 4 : 1);
    {
      const pa = pixels.geometry.attributes.position;
      for (let i = 0; i < PXN; i++) {
        const q = pxItems[i];
        q.y += q.v * dt * (1 + bgLvl * 2 + (thinking ? 1 : 0));
        if (q.y > 4.4) { q.y = -4.4; q.x = rnd(-6.5, 6.5); }
        pa.setXYZ(i, q.x + Math.sin(t * 0.4 + q.ph) * 0.12, q.y, q.z);
      }
      pa.needsUpdate = true;
      pixels.material.color.set(thinking ? 0xffb070 : 0xc8ecff);
      pixels.material.opacity = 0.55 + bgLvl * 0.35 + flash * 0.2;
    }
    ringMats.forEach((m) => m.color.copy(thinking ? amberC : setEar.base));
    nebulae.forEach((N) => {
      N.sp.position.x = N.ox + Math.sin(t * 0.07 + N.ph) * 0.7;
      N.sp.position.y = N.oy + Math.cos(t * 0.05 + N.ph) * 0.4;
      N.sp.material.opacity = N.o * (1 + 0.25 * Math.sin(t * 0.3 + N.ph) + bgLvl * 0.5);
    });
    scan.position.y = ((t * 0.3) % 1) * 5.4 - 2.7;
    // ondas
    ripples.forEach((r) => {
      if (r.t >= 1) { r.m.visible = false; return; }
      r.t += dt / 0.8;
      const s = 0.2 + r.t * 1.5;
      r.m.scale.set(s, s, 1);
      r.m.material.opacity = Math.max(0, 0.95 * (1 - r.t));
    });

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  // Sem cenário (só o robô, fundo transparente): usado para gerar a imagem da barra inferior.
  if (opts.scenery === false) {
    bg.visible = false;
    halo.visible = false;
    floor.visible = false;
  }

  kick();

  return {
    setState(s: OliState) {
      state = s;
    },
    setLevel(v: number) {
      level = Math.max(0, Math.min(1, v));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("pointermove", onWindowMove);
      // Libera tudo da GPU: geometrias, materiais e texturas (a tela pode montar/desmontar).
      const mats = new Set<THREE.Material>();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
        else if (mat) mats.add(mat);
      });
      [...neonSets.flatMap((n) => [n.core, n.glow]), screenMat, hitMat, bodyMat, accentMat, btnMat, leafMat, rimMat, gridMat].forEach((m) => mats.add(m));
      mats.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      envTarget?.dispose();
      scene.environment = null;
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
