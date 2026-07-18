import * as THREE from "three";

export type Side = "left" | "right";
type ActionType = "idle" | "lunge" | "recoil" | "ko";

function buildFighter(colorHex: number, faceDir: number) {
  const group = new THREE.Group();
  const dark = new THREE.Color(colorHex).multiplyScalar(0.32);
  const bodyMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.55, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: new THREE.Color(colorHex),
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.6), bodyMat);
  torso.position.y = 1.15;
  torso.castShadow = true;

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.62), accentMat);
  chest.position.set(0, 1.35, 0.01);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.58), bodyMat);
  head.position.y = 2.0;
  head.castShadow = true;

  const eyeMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 1.6 });
  const eyeGeo = new THREE.BoxGeometry(0.12, 0.08, 0.05);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.15 * faceDir, 2.05, 0.3 * faceDir + (faceDir > 0 ? 0 : 0));
  eyeR.position.set(0.02 * faceDir, 2.05, 0.3 * faceDir);
  eyeL.position.z = 0.3 * faceDir;
  eyeR.position.z = 0.3 * faceDir;

  const armGeo = new THREE.BoxGeometry(0.28, 0.85, 0.28);
  const armFront = new THREE.Mesh(armGeo, bodyMat); // the striking arm (toward opponent)
  armFront.position.set(0.62 * faceDir, 1.25, 0.15);
  armFront.castShadow = true;
  const armBack = new THREE.Mesh(armGeo, bodyMat);
  armBack.position.set(-0.62 * faceDir, 1.2, -0.1);

  const legGeo = new THREE.BoxGeometry(0.34, 0.9, 0.36);
  const legL = new THREE.Mesh(legGeo, bodyMat);
  legL.position.set(-0.28, 0.45, 0);
  const legR = new THREE.Mesh(legGeo, bodyMat);
  legR.position.set(0.28, 0.45, 0);
  legL.castShadow = legR.castShadow = true;

  group.add(torso, chest, head, eyeL, eyeR, armFront, armBack, legL, legR);
  return { group, accentMat, chest, armFront, head };
}

export type Arena = {
  setFighters: (a: { color: number }, b: { color: number }) => void;
  strike: (attacker: Side, power: number, crit?: boolean) => void; // buy: lunge + hit opponent
  stagger: (who: Side, power: number) => void; // sell: self recoil
  ko: (loser: Side) => void;
  reset: () => void;
  dispose: () => void;
};

export function createArena(canvas: HTMLCanvasElement): Arena {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090c);
  scene.fog = new THREE.Fog(0x07090c, 9, 22);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const camBase = new THREE.Vector3(0, 3.4, 9.2);
  camera.position.copy(camBase);
  camera.lookAt(0, 1.4, 0);

  scene.add(new THREE.AmbientLight(0x8899aa, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  scene.add(key);
  const rimL = new THREE.PointLight(0xc4ff3e, 0.8, 20);
  rimL.position.set(-5, 3, 3);
  const rimR = new THREE.PointLight(0xff4d4d, 0.7, 20);
  rimR.position.set(5, 3, 3);
  scene.add(rimL, rimR);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshStandardMaterial({ color: 0x0c1110, roughness: 0.9, metalness: 0.1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(8.4, 8.7, 64),
    new THREE.MeshBasicMaterial({ color: 0x1a2a1a, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);
  const grid = new THREE.GridHelper(18, 24, 0x14201a, 0x0e150f);
  grid.position.y = 0.001;
  scene.add(grid);

  const LX = -2.4;
  const RX = 2.4;
  const left = buildFighter(0xc4ff3e, 1);
  const right = buildFighter(0xff4d4d, -1);
  left.group.position.x = LX;
  right.group.position.x = RX;
  scene.add(left.group, right.group);

  const state = {
    left: { fighter: left, base: LX, dir: 1, action: "idle" as ActionType, t: 0, power: 0, flash: 0 },
    right: { fighter: right, base: RX, dir: -1, action: "idle" as ActionType, t: 0, power: 0, flash: 0 },
    shake: 0,
    koActive: false,
  };
  const other = (s: Side): Side => (s === "left" ? "right" : "left");

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
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;

    for (const key of ["left", "right"] as Side[]) {
      const s = state[key];
      const g = s.fighter.group;
      // idle bob + guard sway
      const idleY = Math.sin(time * 2.2 + (key === "left" ? 0 : 1)) * 0.06;
      let x = s.base;
      let lean = Math.sin(time * 1.3 + (key === "left" ? 0.5 : 2)) * 0.03;
      let armSwing = 0;

      if (s.action !== "idle") {
        s.t += dt;
        if (s.action === "lunge") {
          const p = Math.min(s.t / 0.34, 1);
          const punch = Math.sin(p * Math.PI); // 0→1→0
          x = s.base - s.dir * punch * (1.15 + s.power * 0.5);
          armSwing = punch * 1.2 * s.dir;
          lean += punch * 0.18 * s.dir;
          if (p >= 1) { s.action = "idle"; s.t = 0; }
        } else if (s.action === "recoil") {
          const p = Math.min(s.t / 0.32, 1);
          const kick = Math.sin(p * Math.PI);
          x = s.base + s.dir * kick * (0.55 + s.power * 0.4);
          lean -= kick * 0.3 * s.dir;
          if (p >= 1) { s.action = "idle"; s.t = 0; }
        } else if (s.action === "ko") {
          const p = Math.min(s.t / 1.1, 1);
          g.rotation.z = s.dir * p * 1.3;
          g.position.y = -p * 0.4;
          x = s.base + s.dir * p * 0.6;
        }
      }
      if (s.action !== "ko") { g.rotation.z = lean; g.position.y = idleY; }
      g.position.x = x;
      g.rotation.y = 0;
      s.fighter.armFront.rotation.x = -armSwing;

      // flash decay (hit feedback on the accent + chest)
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 3.2);
      s.fighter.accentMat.emissiveIntensity = 0.35 + s.flash * 2.5;
      s.fighter.accentMat.emissive.setHex(s.flash > 0.4 ? 0xffffff : (key === "left" ? 0xc4ff3e : 0xff4d4d));
    }

    // camera shake
    if (state.shake > 0) {
      state.shake = Math.max(0, state.shake - dt * 4);
      camera.position.set(
        camBase.x + (Math.random() - 0.5) * state.shake,
        camBase.y + (Math.random() - 0.5) * state.shake,
        camBase.z,
      );
    } else {
      camera.position.lerp(camBase, 0.2);
    }
    rimL.intensity = 0.6 + Math.sin(time * 3) * 0.15;
    rimR.intensity = 0.5 + Math.sin(time * 3 + 1) * 0.15;

    renderer.render(scene, camera);
  }
  frame();

  return {
    setFighters(a, b) {
      const setColor = (f: ReturnType<typeof buildFighter>, hex: number) => {
        f.accentMat.color.setHex(hex);
        (f.chest.material as THREE.MeshStandardMaterial).color.setHex(hex);
      };
      setColor(left, a.color);
      setColor(right, b.color);
    },
    strike(attacker, power, crit) {
      if (state.koActive) return;
      const s = state[attacker];
      if (s.action === "ko") return;
      s.action = "lunge";
      s.t = 0;
      s.power = Math.min(power, 1.4);
      // opponent takes the hit slightly after the lunge starts
      window.setTimeout(() => {
        if (state.koActive) return;
        const o = state[other(attacker)];
        if (o.action === "ko") return;
        o.action = "recoil";
        o.t = 0;
        o.power = Math.min(power, 1.4) * (crit ? 1.5 : 1);
        o.flash = crit ? 1.4 : 1;
        state.shake = Math.min((crit ? 0.55 : 0.32) + power * 0.3, 1.0);
      }, 130);
    },
    stagger(who, power) {
      if (state.koActive) return;
      const s = state[who];
      if (s.action === "ko") return;
      s.action = "recoil";
      s.t = 0;
      s.power = Math.min(power * 0.6, 0.8);
      s.flash = 0.5;
    },
    ko(loser) {
      state.koActive = true;
      state[loser].action = "ko";
      state[loser].t = 0;
      state.shake = 1.1;
    },
    reset() {
      state.koActive = false;
      for (const k of ["left", "right"] as Side[]) {
        const s = state[k];
        s.action = "idle";
        s.t = 0;
        s.flash = 0;
        s.fighter.group.rotation.z = 0;
        s.fighter.group.position.y = 0;
      }
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
  };
}
