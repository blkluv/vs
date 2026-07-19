import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export type Side = "left" | "right";
type Act = "idle" | "lunge" | "recoil" | "stagger" | "ko";

export type Arena = {
  setFighters: (a: { hue: number; logo?: string | null }, b: { hue: number; logo?: string | null }) => void;
  strike: (attacker: Side, power: number, crit?: boolean) => void;
  stagger: (who: Side, power: number) => void;
  ko: (loser: Side) => void;
  reset: () => void;
  dispose: () => void;
};

const hexFromHue = (h: number) => new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, 0.72, 0.58).getHex();

export function createArena(canvas: HTMLCanvasElement): Arena {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090c);
  scene.fog = new THREE.Fog(0x07090c, 11, 26);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const camBase = new THREE.Vector3(0, 3.4, 9.6);
  camera.position.copy(camBase);
  camera.lookAt(0, 1.6, 0);

  scene.add(new THREE.AmbientLight(0x8a99aa, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(3, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 34;
  scene.add(key);
  const rimL = new THREE.PointLight(0xc4ff3e, 0.9, 24);
  rimL.position.set(-5, 3.5, 3);
  const rimR = new THREE.PointLight(0xff4d4d, 0.8, 24);
  rimR.position.set(5, 3.5, 3);
  scene.add(rimL, rimR);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 56), new THREE.MeshStandardMaterial({ color: 0x0c1110, roughness: 0.92, metalness: 0.08 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(8.4, 8.75, 72), new THREE.MeshBasicMaterial({ color: 0x1c2f1c, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);
  const grid = new THREE.GridHelper(18, 24, 0x14231a, 0x0e160f);
  grid.position.y = 0.002;
  scene.add(grid);

  // impact particle pool
  const pGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const parts = Array.from({ length: 60 }, () => {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.visible = false;
    scene.add(m);
    return { m, vel: new THREE.Vector3(), life: 0 };
  });
  let pIdx = 0;

  const LX = -2.5, RX = 2.5;

  type FS = {
    root: THREE.Group;
    mixer: THREE.AnimationMixer;
    actions: Record<string, THREE.AnimationAction>;
    current?: THREE.AnimationAction;
    mains: THREE.MeshStandardMaterial[];
    decal: THREE.Sprite;
    base: number;
    toCenter: number;
    phase: number;
    act: Act;
    t: number;
    power: number;
    flash: number;
    xoff: number; // manual lunge/recoil offset
  };
  const fighters: Partial<Record<Side, FS>> = {};
  const pending: Partial<Record<Side, { hue: number; logo?: string | null }>> = {};
  const other = (s: Side): Side => (s === "left" ? "right" : "left");
  let shake = 0, koActive = false, hitstop = 0;
  const texLoader = new THREE.TextureLoader();

  function playClip(f: FS, name: string, opts: { loop?: boolean; fade?: number } = {}) {
    const a = f.actions[name];
    if (!a) return;
    a.reset();
    a.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, opts.loop === false ? 1 : Infinity);
    a.clampWhenFinished = opts.loop === false;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (f.current && f.current !== a) f.current.fadeOut(opts.fade ?? 0.15);
    a.fadeIn(opts.fade ?? 0.15).play();
    f.current = a;
  }

  function applyFighterOpts(f: FS, opt: { hue: number; logo?: string | null }) {
    const hex = hexFromHue(opt.hue);
    for (const m of f.mains) { m.color.setHex(hex); m.emissive.setHex(hex); m.emissiveIntensity = 0.12; }
    if (opt.logo) {
      texLoader.load(
        `/api/logo?url=${encodeURIComponent(opt.logo)}`,
        (tex) => { tex.colorSpace = THREE.SRGBColorSpace; (f.decal.material as THREE.SpriteMaterial).map = tex; (f.decal.material as THREE.SpriteMaterial).needsUpdate = true; f.decal.visible = true; },
        undefined,
        () => { f.decal.visible = false; },
      );
    } else f.decal.visible = false;
  }

  // ---- load the rigged character, then build both fighters from clones ----
  new GLTFLoader().load("/models/robot.glb", (gltf) => {
    // normalize scale so the character is ~2.3 units tall with feet on the floor
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const h = box.max.y - box.min.y || 1;
    const scale = 2.3 / h;

    const build = (side: Side, base: number, faceY: number, toCenter: number, phase: number): FS => {
      const root = cloneSkinned(gltf.scene) as THREE.Group;
      root.scale.setScalar(scale);
      const b2 = new THREE.Box3().setFromObject(root);
      root.position.set(base, -b2.min.y, 0);
      root.rotation.y = faceY;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          // clone materials so recoloring one fighter doesn't affect the other
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : (mesh.material as THREE.Material).clone();
        }
      });
      const mains: THREE.MeshStandardMaterial[] = [];
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial && /main/i.test(m.name)) mains.push(m as THREE.MeshStandardMaterial);
        }
      });

      // token logo as a billboard floating above the head, always facing the camera
      const decal = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      decal.scale.set(1.0, 1.0, 1);
      decal.position.set(base, 3.0, 0);
      decal.renderOrder = 20;
      decal.visible = false;
      scene.add(decal);

      const glow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(base, 0.02, 0);
      scene.add(glow);

      scene.add(root);
      const mixer = new THREE.AnimationMixer(root);
      const actions: Record<string, THREE.AnimationAction> = {};
      for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);

      const f: FS = { root, mixer, actions, mains, decal, base, toCenter, phase, act: "idle", t: 0, power: 0, flash: 0, xoff: 0 };
      playClip(f, "Idle");
      return f;
    };

    fighters.left = build("left", LX, Math.PI / 2, 1, 0);
    fighters.right = build("right", RX, -Math.PI / 2, -1, 1.3);
    if (pending.left) applyFighterOpts(fighters.left, pending.left);
    if (pending.right) applyFighterOpts(fighters.right, pending.right);
  });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    let dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    if (hitstop > 0) { hitstop -= dt; dt *= 0.12; }

    for (const side of ["left", "right"] as Side[]) {
      const f = fighters[side];
      if (!f) continue;
      f.mixer.update(dt);

      // manual root offset for lunge/recoil (blended on top of the baked clip)
      let targetX = 0;
      if (f.act === "lunge") { f.t += dt; const p = Math.min(f.t / 0.4, 1); targetX = f.toCenter * Math.sin(p * Math.PI) * (1.0 + f.power * 0.5); if (p >= 1) { f.act = "idle"; f.t = 0; } }
      else if (f.act === "recoil") { f.t += dt; const p = Math.min(f.t / 0.34, 1); targetX = -f.toCenter * Math.sin(p * Math.PI) * (0.5 + f.power * 0.4); if (p >= 1) { f.act = "idle"; f.t = 0; } }
      else if (f.act === "stagger") { f.t += dt; if (f.t > 0.5) { f.act = "idle"; f.t = 0; } }
      f.xoff += (targetX - f.xoff) * Math.min(1, dt * 16);
      f.root.position.x = f.base + f.xoff;
      f.decal.position.x = f.root.position.x; // logo billboard follows the fighter

      if (f.flash > 0) { f.flash = Math.max(0, f.flash - dt * 3.2); for (const m of f.mains) m.emissiveIntensity = 0.12 + f.flash * 1.6; }
    }

    for (const p of parts) {
      if (p.life <= 0) { if (p.m.visible) p.m.visible = false; continue; }
      p.life -= dt;
      p.vel.y -= 14 * dt;
      p.m.position.addScaledVector(p.vel, dt);
      p.m.scale.multiplyScalar(1 - dt * 3);
      if (p.m.position.y < 0.05) p.m.visible = false;
    }

    if (shake > 0) { shake = Math.max(0, shake - dt * 4); camera.position.set(camBase.x + (Math.random() - 0.5) * shake, camBase.y + (Math.random() - 0.5) * shake, camBase.z); }
    else camera.position.lerp(camBase, 0.2);
    rimL.intensity = 0.7 + Math.sin(time * 3) * 0.15;
    rimR.intensity = 0.6 + Math.sin(time * 3 + 1) * 0.15;

    renderer.render(scene, camera);
  }
  frame();

  return {
    setFighters(a, b) {
      pending.left = a; pending.right = b;
      if (fighters.left) applyFighterOpts(fighters.left, a);
      if (fighters.right) applyFighterOpts(fighters.right, b);
    },
    strike(attacker, power, crit) {
      if (koActive) return;
      const f = fighters[attacker];
      if (!f || f.act === "ko") return;
      f.act = "lunge"; f.t = 0; f.power = Math.min(power, 1.4);
      playClip(f, "Punch", { loop: false, fade: 0.08 });
      // return to idle after the punch clip
      window.setTimeout(() => { if (f.act !== "ko") playClip(f, "Idle", { fade: 0.2 }); }, 550);
      window.setTimeout(() => {
        if (koActive) return;
        const o = fighters[other(attacker)];
        if (!o || o.act === "ko") return;
        o.act = "recoil"; o.t = 0; o.power = Math.min(power, 1.4) * (crit ? 1.4 : 1); o.flash = crit ? 1.5 : 1;
        shake = Math.min((crit ? 0.6 : 0.32) + power * 0.28, 1.05);
        if (crit) hitstop = 0.09;
        burst(o.root.position.x, 1.4, crit ? 0xffffff : 0xffddaa, crit ? 16 : 9);
      }, 130);
    },
    stagger(who) {
      if (koActive) return;
      const f = fighters[who];
      if (!f || f.act === "ko") return;
      f.act = "stagger"; f.t = 0; // exposed; no flash, no baked hit
    },
    ko(loser) {
      koActive = true;
      const f = fighters[loser];
      if (f) { f.act = "ko"; playClip(f, "Death", { loop: false, fade: 0.15 }); }
      shake = 1.15; hitstop = 0.12;
      if (f) burst(f.root.position.x, 1.2, 0xffffff, 22);
    },
    reset() {
      koActive = false;
      for (const side of ["left", "right"] as Side[]) { const f = fighters[side]; if (f) { f.act = "idle"; f.t = 0; f.flash = 0; f.xoff = 0; playClip(f, "Idle", { fade: 0.2 }); } }
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
  };

  // ---- impact particles ----
  function burst(x: number, y: number, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const p = parts[pIdx++ % parts.length];
      p.m.position.set(x, y, 0);
      p.m.visible = true;
      p.life = 0.4 + Math.random() * 0.3;
      (p.m.material as THREE.MeshBasicMaterial).color.setHex(color);
      p.m.scale.setScalar(0.5 + Math.random());
      p.vel.set((Math.random() - 0.5) * 6, Math.random() * 5 + 1, (Math.random() - 0.5) * 6);
    }
  }
}
