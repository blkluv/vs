import * as THREE from "three";

export type Side = "left" | "right";
type Act = "idle" | "lunge" | "recoil" | "stagger" | "ko";

const approach = (o: any, key: string, target: number, k: number, dt: number) => {
  o[key] += (target - o[key]) * Math.min(1, dt * k);
};

function buildFighter(color: number) {
  const root = new THREE.Group();
  const bodyCol = new THREE.Color(color).multiplyScalar(0.34);
  const body = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.4 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 2.2 });

  const hips = new THREE.Group();
  hips.position.y = 1.05;
  root.add(hips);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.15, 0.6), body);
  torso.position.y = 0.55;
  torso.castShadow = true;
  hips.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.44, 0.62), accent);
  chest.position.set(0, 0.72, 0.02);
  hips.add(chest);

  const neck = new THREE.Group();
  neck.position.y = 1.15;
  hips.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.56, 0.56), body);
  head.position.y = 0.3;
  head.castShadow = true;
  neck.add(head);
  const eyeGeo = new THREE.BoxGeometry(0.1, 0.09, 0.05);
  const eyeA = new THREE.Mesh(eyeGeo, eyeMat);
  eyeA.position.set(0.29, 0.34, 0.15); // eyes on the +x (forward) face
  const eyeB = new THREE.Mesh(eyeGeo, eyeMat);
  eyeB.position.set(0.29, 0.34, -0.15);
  neck.add(eyeA, eyeB);

  const makeArm = (zSide: number) => {
    const sh = new THREE.Group();
    sh.position.set(0.12, 0.95, zSide * 0.44); // shoulder
    hips.add(sh);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.72, 10), body);
    upper.rotation.z = -Math.PI / 2; // lay along +x
    upper.position.x = 0.36;
    upper.castShadow = true;
    sh.add(upper);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), accent);
    fist.position.x = 0.8;
    sh.add(fist);
    return sh;
  };
  const armF = makeArm(1); // lead arm
  const armB = makeArm(-1);

  const makeLeg = (xSide: number) => {
    const hp = new THREE.Group();
    hp.position.set(xSide * 0.22, 0, 0);
    hips.add(hp);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.98, 10), body);
    l.position.y = -0.52;
    l.castShadow = true;
    hp.add(l);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.52), body);
    foot.position.set(0, -1.02, 0.12);
    hp.add(foot);
    return hp;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  return { root, hips, neck, armF, armB, legL, legR, mats: { body, accent, eyeMat } };
}
type FighterRig = ReturnType<typeof buildFighter>;

export type Arena = {
  setFighters: (a: { hue: number }, b: { hue: number }) => void;
  strike: (attacker: Side, power: number, crit?: boolean) => void;
  stagger: (who: Side, power: number) => void;
  ko: (loser: Side) => void;
  reset: () => void;
  dispose: () => void;
};

const hexFromHue = (h: number) => new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, 0.75, 0.6).getHex();

export function createArena(canvas: HTMLCanvasElement): Arena {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090c);
  scene.fog = new THREE.Fog(0x07090c, 10, 24);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const camBase = new THREE.Vector3(0, 3.4, 9.4);
  camera.position.copy(camBase);
  camera.lookAt(0, 1.5, 0);

  scene.add(new THREE.AmbientLight(0x8a99aa, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(3, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 32;
  scene.add(key);
  const rimL = new THREE.PointLight(0xc4ff3e, 0.9, 22);
  rimL.position.set(-5, 3.5, 3);
  const rimR = new THREE.PointLight(0xff4d4d, 0.8, 22);
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

  const LX = -2.5;
  const RX = 2.5;
  const left = buildFighter(0xc4ff3e);
  const right = buildFighter(0xff4d4d);
  left.root.position.x = LX;
  right.root.position.x = RX;
  right.root.rotation.y = Math.PI; // face left
  scene.add(left.root, right.root);

  type FS = { rig: FighterRig; base: number; toCenter: number; phase: number; act: Act; t: number; power: number; flash: number; koDir: number };
  const S: Record<Side, FS> = {
    left: { rig: left, base: LX, toCenter: 1, phase: 0, act: "idle", t: 0, power: 0, flash: 0, koDir: -1 },
    right: { rig: right, base: RX, toCenter: -1, phase: 1.3, act: "idle", t: 0, power: 0, flash: 0, koDir: 1 },
  };
  const other = (s: Side): Side => (s === "left" ? "right" : "left");
  let shake = 0;
  let koActive = false;
  let hitstop = 0;

  // ---- impact particles ----
  const PMAX = 60;
  const pGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const parts = Array.from({ length: PMAX }, () => {
    const m = new THREE.Mesh(pGeo, pMat.clone());
    m.visible = false;
    scene.add(m);
    return { m, vel: new THREE.Vector3(), life: 0 };
  });
  let pIdx = 0;
  function burst(pos: THREE.Vector3, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const p = parts[pIdx++ % PMAX];
      p.m.position.copy(pos);
      p.m.visible = true;
      p.life = 0.4 + Math.random() * 0.3;
      (p.m.material as THREE.MeshBasicMaterial).color.setHex(color);
      p.m.scale.setScalar(0.5 + Math.random());
      p.vel.set((Math.random() - 0.5) * 6, Math.random() * 5 + 1, (Math.random() - 0.5) * 6);
    }
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  function pose(s: FS, dt: number, time: number) {
    const F = s.rig;
    const K = 16;
    // guard defaults
    let rootX = s.base, rootY = 0, rootRz = 0;
    let hipsY = 1.05 + Math.sin(time * 3 + s.phase) * 0.045;
    let hipsRy = Math.sin(time * 1.4 + s.phase) * 0.05;
    let hipsRz = 0;
    let neckRx = Math.sin(time * 2 + s.phase) * 0.03, neckRz = 0;
    let aFz = 0.66, aFy = -0.38, aBz = 0.86, aBy = 0.32;
    let legRx = 0, legLx = 0;

    if (!koActive || s.act === "ko") s.t += dt;

    if (s.act === "lunge") {
      const p = Math.min(s.t / 0.32, 1), pu = Math.sin(p * Math.PI);
      rootX = s.base + s.toCenter * pu * (1.15 + s.power * 0.55);
      hipsRy += pu * 0.42;
      aFz = 0.66 - pu * 0.82;
      aFy = -0.38 - pu * 0.14;
      aBz = 0.86 + pu * 0.15;
      legRx = -pu * 0.42;
      if (p >= 1) { s.act = "idle"; s.t = 0; }
    } else if (s.act === "recoil") {
      const p = Math.min(s.t / 0.34, 1), ki = Math.sin(p * Math.PI);
      rootX = s.base - s.toCenter * ki * (0.5 + s.power * 0.45);
      neckRz = ki * 0.55; neckRx = -ki * 0.35;
      hipsRy = -ki * 0.22;
      aFz = 0.66 + ki * 0.5; aBz = 0.86 + ki * 0.3;
      legLx = ki * 0.32;
      if (p >= 1) { s.act = "idle"; s.t = 0; }
    } else if (s.act === "stagger") {
      const p = Math.min(s.t / 0.55, 1), w = Math.sin(p * Math.PI);
      rootRz = s.toCenter * w * 0.14;
      hipsRz = Math.sin(s.t * 26) * 0.09 * (1 - p);
      aFz = 0.66 - w * 0.62; aBz = 0.86 - w * 0.5;
      neckRx = w * 0.25;
      if (p >= 1) { s.act = "idle"; s.t = 0; }
    } else if (s.act === "ko") {
      const p = Math.min(s.t / 1.15, 1);
      rootRz = s.koDir * p * 1.5;
      rootY = -p * 0.55;
      rootX = s.base + s.toCenter * p * 0.4;
      legRx = p * 0.5; legLx = p * 0.5;
      aFz = 0.66 + p * 0.4; aBz = 0.86 + p * 0.4;
      neckRx = p * 0.45;
    }

    approach(F.root.position, "x", rootX, K, dt);
    approach(F.root.position, "y", rootY, K, dt);
    approach(F.root.rotation, "z", rootRz, K, dt);
    approach(F.hips.position, "y", hipsY, K, dt);
    approach(F.hips.rotation, "y", hipsRy, K, dt);
    approach(F.hips.rotation, "z", hipsRz, K, dt);
    approach(F.neck.rotation, "x", neckRx, K, dt);
    approach(F.neck.rotation, "z", neckRz, K, dt);
    approach(F.armF.rotation, "z", aFz, K, dt);
    approach(F.armF.rotation, "y", aFy, K, dt);
    approach(F.armB.rotation, "z", aBz, K, dt);
    approach(F.armB.rotation, "y", aBy, K, dt);
    approach(F.legR.rotation, "x", legRx, K, dt);
    approach(F.legL.rotation, "x", legLx, K, dt);

    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 3.2);
    F.mats.accent.emissiveIntensity = 0.4 + s.flash * 2.6;
  }

  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    let dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    if (hitstop > 0) { hitstop -= dt; dt *= 0.12; } // freeze frames on big hits

    pose(S.left, dt, time);
    pose(S.right, dt, time);

    for (const p of parts) {
      if (p.life <= 0) { if (p.m.visible) p.m.visible = false; continue; }
      p.life -= dt;
      p.vel.y -= 14 * dt;
      p.m.position.addScaledVector(p.vel, dt);
      p.m.scale.multiplyScalar(1 - dt * 3);
      if (p.m.position.y < 0.05 || p.life <= 0) p.m.visible = false;
    }

    if (shake > 0) {
      shake = Math.max(0, shake - dt * 4);
      camera.position.set(camBase.x + (Math.random() - 0.5) * shake, camBase.y + (Math.random() - 0.5) * shake, camBase.z);
    } else camera.position.lerp(camBase, 0.2);
    rimL.intensity = 0.7 + Math.sin(time * 3) * 0.15;
    rimR.intensity = 0.6 + Math.sin(time * 3 + 1) * 0.15;

    renderer.render(scene, camera);
  }
  frame();

  const contactPoint = (defender: Side) => {
    const v = new THREE.Vector3();
    S[defender].rig.hips.getWorldPosition(v);
    v.y += 0.7;
    return v;
  };

  return {
    setFighters(a, b) {
      const recolor = (F: FighterRig, hex: number) => {
        F.mats.accent.color.setHex(hex);
        F.mats.accent.emissive.setHex(hex);
        F.mats.body.color.copy(new THREE.Color(hex).multiplyScalar(0.34));
        F.mats.eyeMat.emissive.setHex(hex);
      };
      recolor(left, hexFromHue(a.hue));
      recolor(right, hexFromHue(b.hue));
    },
    strike(attacker, power, crit) {
      if (koActive) return;
      const s = S[attacker];
      if (s.act === "ko") return;
      s.act = "lunge";
      s.t = 0;
      s.power = Math.min(power, 1.4);
      window.setTimeout(() => {
        if (koActive) return;
        const o = S[other(attacker)];
        if (o.act === "ko") return;
        o.act = "recoil";
        o.t = 0;
        o.power = Math.min(power, 1.4) * (crit ? 1.4 : 1);
        o.flash = crit ? 1.5 : 1;
        shake = Math.min((crit ? 0.6 : 0.32) + power * 0.28, 1.05);
        if (crit) hitstop = 0.09;
        const col = (o.rig.mats.accent.color as THREE.Color).getHex();
        burst(contactPoint(other(attacker)), crit ? 0xffffff : col, crit ? 16 : 9);
      }, 120);
    },
    stagger(who, power) {
      if (koActive) return;
      const s = S[who];
      if (s.act === "ko") return;
      s.act = "stagger";
      s.t = 0;
      s.power = Math.min(power * 0.7, 0.9);
      s.flash = 0.5;
    },
    ko(loser) {
      koActive = true;
      S[loser].act = "ko";
      S[loser].t = 0;
      shake = 1.15;
      hitstop = 0.12;
      burst(contactPoint(loser), 0xffffff, 22);
    },
    reset() {
      koActive = false;
      for (const k of ["left", "right"] as Side[]) {
        S[k].act = "idle";
        S[k].t = 0;
        S[k].flash = 0;
      }
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
  };
}
