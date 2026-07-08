import { Suspense, forwardRef, useImperativeHandle, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, RoundedBox, Lightformer } from "@react-three/drei";
import { EffectComposer, Bloom, DepthOfField, Vignette, ToneMapping } from "@react-three/postprocessing";
import { motion, AnimatePresence } from "framer-motion";
import * as THREE from "three";
import { KernelSize } from "postprocessing";

/* ===================================================================
   CONSTANTS
   =================================================================== */

export const DURATION = 10;

const PHASES = [
  { t: 0.0, label: "Rain falls from the sky" },
  { t: 1.2, label: "Water runs down the roof" },
  { t: 2.6, label: "Collected by the gutter" },
  { t: 3.6, label: "Down the downspout — free fall" },
  { t: 5.0, label: "Through the S-curve French drain" },
  { t: 6.8, label: "Catch basin fills… sump pump kicks ON" },
  { t: 8.2, label: "Discharged via PVC past the curb to the street" },
];

const WATER_TIMES = [0, 1.2, 2.6, 3.6, 4.6, 5.0, 5.6, 6.2, 6.6, 7.0, 8.2, 8.8, 9.4, 10];
const WATER_POINTS = [
  new THREE.Vector3(3.5, 9.0, 8.5),
  new THREE.Vector3(3.5, 4.6, 8.2),
  new THREE.Vector3(3.5, 3.6, 6.9),
  new THREE.Vector3(0.6, 3.55, 6.8),
  new THREE.Vector3(0.45, 0.25, 6.8),
  new THREE.Vector3(0.2, 0.12, 5.6),
  new THREE.Vector3(-1.4, 0.1, 3.8),
  new THREE.Vector3(1.3, 0.1, 2.0),
  new THREE.Vector3(-0.6, 0.08, 0.2),
  new THREE.Vector3(0, -0.2, -1.2),
  new THREE.Vector3(0, -0.45, -1.2),
  new THREE.Vector3(0, -0.5, -2.6),
  new THREE.Vector3(0, -0.2, -5.6),
  new THREE.Vector3(0, 0.1, -7.4),
];
const waterCurve = new THREE.CatmullRomCurve3(WATER_POINTS, false, "catmullrom", 0.2);

function waterPositionAt(t) {
  const clamped = THREE.MathUtils.clamp(t, 0, DURATION);
  let i = 0;
  while (i < WATER_TIMES.length - 2 && clamped > WATER_TIMES[i + 1]) i++;
  const alpha = (clamped - WATER_TIMES[i]) / (WATER_TIMES[i + 1] - WATER_TIMES[i] || 1);
  const u = (i + THREE.MathUtils.clamp(alpha, 0, 1)) / (WATER_POINTS.length - 1);
  return waterCurve.getPoint(u);
}

const CAMERA_KEYS = [
  { t: 0.0, pos: [9, 6.5, 14], tgt: [3.5, 5, 8] },
  { t: 2.4, pos: [7, 5, 12], tgt: [2, 3.5, 7] },
  { t: 4.4, pos: [4, 2.6, 10.5], tgt: [0.4, 1.4, 6.6] },
  { t: 6.4, pos: [3.2, 2.2, 3.8], tgt: [-0.2, 0.1, 2.2] },
  { t: 8.0, pos: [2.6, 1.8, 0.9], tgt: [0, -0.2, -1.2] },
  { t: 10.0, pos: [2.6, 2.4, -4.2], tgt: [0, 0, -7.2] },
];

/* ===================================================================
   EASING UTILITY - smoothstep with anticipation/overshoot
   =================================================================== */

function easeInOutBack(t) {
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
}

/* ===================================================================
   PHASE 6 — CameraRig with dynamic ease + micro-shake
   =================================================================== */

function CameraRig({ clockRef, shakeIntensity }) {
  const pos = useRef(new THREE.Vector3());
  const tgt = useRef(new THREE.Vector3());
  const basePos = useRef(new THREE.Vector3());
  const baseTgt = useRef(new THREE.Vector3());
  const shakeSeed = useRef(0);

  useFrame(({ camera }) => {
    const t = clockRef.current.t;
    let i = 0;
    while (i < CAMERA_KEYS.length - 2 && t > CAMERA_KEYS[i + 1].t) i++;
    const a = CAMERA_KEYS[i];
    const b = CAMERA_KEYS[i + 1];
    const raw = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t || 1), 0, 1);
    const s = easeInOutBack(raw);

    pos.current.fromArray(a.pos).lerp(basePos.current.fromArray(b.pos), s);
    camera.position.copy(pos.current);
    pos.current.fromArray(a.tgt).lerp(baseTgt.current.fromArray(b.tgt), s);
    camera.lookAt(pos.current);

    // micro-shake during intense moments
    shakeSeed.current += 0.05;
    if (shakeIntensity.current > 0) {
      const sx = (Math.sin(shakeSeed.current * 13.7) * 0.5 + Math.sin(shakeSeed.current * 7.3) * 0.5) * shakeIntensity.current;
      const sy = (Math.sin(shakeSeed.current * 11.3) * 0.5 + Math.sin(shakeSeed.current * 5.7) * 0.5) * shakeIntensity.current;
      camera.position.x += sx;
      camera.position.y += sy;
    }
  });

  return null;
}

/* ===================================================================
   TimelineDriver
   =================================================================== */

function TimelineDriver({ clockRef, onPhase, externalProgress }) {
  const lastPhase = useRef(-1);
  useFrame((_, delta) => {
    if (!externalProgress) {
      clockRef.current.t = (clockRef.current.t + delta) % DURATION;
    }
    const t = clockRef.current.t;
    let phase = 0;
    for (let i = 0; i < PHASES.length; i++) if (t >= PHASES[i].t) phase = i;
    if (phase !== lastPhase.current) {
      lastPhase.current = phase;
      onPhase(phase);
    }
  });
  return null;
}

/* ===================================================================
   SHAKE TRACKER - feeds CameraRig shakeIntensity
   =================================================================== */

function ShakeTracker({ clockRef, shakeIntensity }) {
  useFrame(() => {
    const t = clockRef.current.t;
    // shake during: free fall (3.6-4.6), pump kick-on (7.8-8.8), curb discharge (9.2-10)
    const shake =
      Math.max(0, 1 - Math.abs(t - 4.1) / 0.5) * 0.06 +
      Math.max(0, 1 - Math.abs(t - 8.3) / 0.5) * 0.04 +
      Math.max(0, 1 - Math.abs(t - 9.7) / 0.4) * 0.03;
    shakeIntensity.current = shake;
  });
  return null;
}

/* ===================================================================
   PHASE 4 — Rain (tapered drops, motion-blur elongation + wind)
   =================================================================== */

function Rain({ clockRef, count = 90 }) {
  const mesh = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const drops = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: THREE.MathUtils.randFloat(-7, 9),
        z: THREE.MathUtils.randFloat(-8, 11),
        y: Math.random() * 15,
        speed: 9 + Math.random() * 4,
        wind: 0.3 + Math.random() * 0.4,
        phaseOffset: i * 0.7,
      })),
    [count]
  );

  useFrame((_, delta) => {
    const t = clockRef.current.t;
    const windGust = Math.sin(t * 0.6) * 0.5 + 0.5; // gentle gust
    drops.forEach((d, i) => {
      d.y -= d.speed * delta;
      d.x += d.wind * windGust * delta * 0.3;
      if (d.y < 0.1) {
        d.y = 15;
        d.x = THREE.MathUtils.randFloat(-7, 9);
        d.z = THREE.MathUtils.randFloat(-8, 11);
      }
      dummy.position.set(d.x, d.y, d.z);
      dummy.rotation.z = Math.atan2(d.wind * windGust * 0.3, -d.speed) + Math.PI / 2;
      dummy.rotation.x = d.wind * windGust * 0.02;
      dummy.scale.set(1, 1 + windGust * 1.2, 1);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[null, null, count]}>
      <capsuleGeometry args={[0.008, 0.6, 4, 8]} />
      <meshPhysicalMaterial
        color="#d4e9f7"
        metalness={0.0}
        roughness={0.06}
        transparent
        opacity={0.6}
        envMapIntensity={0.7}
      />
    </instancedMesh>
  );
}

/* ===================================================================
   PHASE 4 — WaterPackets (trail with size falloff + glow)
   =================================================================== */

function WaterPackets({ clockRef, count = 12 }) {
  const refs = useRef([]);

  useFrame(() => {
    const t = clockRef.current.t;
    for (let i = 0; i < count; i++) {
      const m = refs.current[i];
      if (!m) continue;
      const tt = t - i * 0.12;
      const visible = tt > 0 && tt < DURATION;
      m.visible = visible;
      if (visible) {
        m.position.copy(waterPositionAt(tt));
        const scale = 1 - (i / count) * 0.5;
        m.scale.setScalar(scale);
      }
    }
  });

  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)}>
          <sphereGeometry args={[0.12 - i * 0.005, 20, 20]} />
          <meshPhysicalMaterial
            color="#a8d9ff"
            emissive="#5cc4ff"
            emissiveIntensity={2.4 - i * 0.1}
            roughness={0.0}
            metalness={0.05}
            clearcoat={0.6}
            clearcoatRoughness={0.1}
            envMapIntensity={1.1}
            transparent
            opacity={Math.max(0.35, 1 - i * 0.05)}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ===================================================================
   PHASE 4 — RoofWaterFlow (shader-driven flow on roof surface)
   =================================================================== */

function RoofWaterFlow({ clockRef }) {
  const mesh = useRef();

  const flowShader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#7fcfff") },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        // flowing streaks along roof slope
        float flow = sin(uv.x * 30.0 - uTime * 4.0 + uv.y * 8.0) * 0.5 + 0.5;
        float streaks = sin(uv.x * 50.0 + uv.y * 20.0 - uTime * 6.0) * 0.5 + 0.5;
        float alpha = pow(flow * streaks, 3.0) * 0.5;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  useFrame(() => {
    if (mesh.current) {
      mesh.current.material.uniforms.uTime.value = clockRef.current.t;
      const t = clockRef.current.t;
      mesh.current.visible = t >= 1.0 && t <= 3.8;
    }
  });

  return (
    <mesh
      ref={mesh}
      position={[3.5, 4.12, 7.85]}
      rotation={[0.62, 0, 0]}
      visible={false}
    >
      <planeGeometry args={[6.8, 2.6]} />
      <shaderMaterial args={[flowShader]} />
    </mesh>
  );
}

/* ===================================================================
   PHASE 4 — DownspoutSpiral (helical water particles in the downspout)
   =================================================================== */

function DownspoutSpiral({ clockRef }) {
  const mesh = useRef();
  const count = 20;
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const t = clockRef.current.t;
    if (!mesh.current) return;
    const active = t >= 3.0 && t <= 5.2;
    mesh.current.visible = active;
    if (!active) return;
    const localT = (t - 3.0) / 2.2;
    for (let i = 0; i < count; i++) {
      const phase = (i / count) * Math.PI * 2;
      const y = (localT * 3.3 + i * 0.08) % 3.3 - 0.2;
      const r = 0.035 + Math.sin(phase + localT * 20) * 0.015;
      dummy.position.set(
        Math.cos(phase + localT * 16 + i * 0.3) * r + 0.45,
        1.85 + y,
        Math.sin(phase + localT * 16 + i * 0.3) * r + 6.8
      );
      dummy.scale.setScalar(0.5 + Math.sin(phase + localT * 10) * 0.3);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[null, null, count]} visible={false}>
      <sphereGeometry args={[0.025, 6, 6]} />
      <meshPhysicalMaterial color="#7fcfff" emissive="#4db8ff" emissiveIntensity={1.5} roughness={0.0} />
    </instancedMesh>
  );
}

/* ===================================================================
   PHASE 4 — DischargeSplash (particles at curb outlet)
   =================================================================== */

function DischargeSplash({ clockRef }) {
  const points = useRef();

  const particleCount = 80;
  const positions = useMemo(() => new Float32Array(particleCount * 3), []);
  const velocities = useMemo(() => {
    const v = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.4;
      const speed = 0.5 + Math.random() * 1.5;
      v[i * 3] = Math.cos(theta) * Math.sin(phi) * speed;
      v[i * 3 + 1] = Math.cos(phi) * speed * 0.8;
      v[i * 3 + 2] = -Math.sin(theta) * Math.sin(phi) * speed - 0.5;
    }
    return v;
  }, []);
  const life = useRef(new Float32Array(particleCount).fill(0));

  useFrame((_, delta) => {
    const t = clockRef.current.t;
    const active = t >= 9.3;
    if (!points.current) return;

    const pos = points.current.geometry.attributes.position.array;
    if (!active) {
      for (let i = 0; i < particleCount; i++) {
        pos[i * 3] = 0;
        pos[i * 3 + 1] = -10;
        pos[i * 3 + 2] = -7.4;
        life.current[i] = 0;
      }
      points.current.geometry.attributes.position.needsUpdate = true;
      points.current.visible = false;
      return;
    }

    points.current.visible = true;
    const dt = Math.min(delta, 0.05);

    for (let i = 0; i < particleCount; i++) {
      life.current[i] += dt;
      const lifeVal = life.current[i];
      // reset dead particles
      if (lifeVal > 2.5 || pos[i * 3 + 1] < -0.5) {
        life.current[i] = 0;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.35;
        const speed = 0.5 + Math.random() * 1.5;
        velocities[i * 3] = Math.cos(theta) * Math.sin(phi) * speed;
        velocities[i * 3 + 1] = Math.cos(phi) * speed * 0.8 + 0.3;
        velocities[i * 3 + 2] = -Math.sin(theta) * Math.sin(phi) * speed - 0.4;
        pos[i * 3] = 0;
        pos[i * 3 + 1] = 0.05;
        pos[i * 3 + 2] = -7.4;
      } else {
        pos[i * 3] += velocities[i * 3] * dt;
        pos[i * 3 + 1] += velocities[i * 3 + 1] * dt - 0.6 * dt; // gravity
        pos[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      }
    }
    points.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={points} visible={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#9fdcff"
        size={0.04}
        transparent
        opacity={0.7}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

/* ===================================================================
   PHASE 1 + 2 + 3 — House, Gutter, Downspout (detailed geometry + materials)
   =================================================================== */

function HouseGutterDownspout() {
  const roofMat = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(0, 0, 128, 128);
    // shingle pattern
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 8; col++) {
        const x = col * 16 + (row % 2) * 8;
        const y = row * 11;
        const shade = 0.6 + Math.random() * 0.3;
        const g = Math.round(shade * 80);
        ctx.fillStyle = `rgb(${g+20}, ${g+15}, ${g+10})`;
        ctx.fillRect(x, y, 15, 9);
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, 15, 9);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 3);
    return tex;
  }, []);

  const wallMat = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#d8caa0";
    ctx.fillRect(0, 0, 64, 64);
    // subtle brick-like texture
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * 64;
      const y = Math.random() * 64;
      const size = 1 + Math.random() * 2;
      ctx.fillStyle = `rgba(160, 140, 100, ${Math.random() * 0.3})`;
      ctx.fillRect(x, y, size, size);
    }
    return new THREE.CanvasTexture(canvas);
  }, []);

  return (
    <group>
      {/* house body */}
      <mesh position={[3.5, 1.7, 9.2]} castShadow>
        <boxGeometry args={[7, 3.4, 3.2]} />
        <meshPhysicalMaterial
          map={wallMat}
          color="#d8caa0"
          roughness={0.85}
          clearcoat={0.05}
          clearcoatRoughness={0.4}
        />
      </mesh>
      {/* window trim left */}
      <mesh position={[4.8, 2.4, 10.7]} castShadow>
        <boxGeometry args={[0.6, 0.8, 0.08]} />
        <meshPhysicalMaterial color="#5a5040" roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh position={[4.8, 2.4, 10.74]}>
        <boxGeometry args={[0.4, 0.5, 0.04]} />
        <meshPhysicalMaterial color="#b8d8ee" roughness={0.3} transparent opacity={0.4} />
      </mesh>
      {/* window trim right */}
      <mesh position={[2.2, 2.4, 10.7]} castShadow>
        <boxGeometry args={[0.6, 0.8, 0.08]} />
        <meshPhysicalMaterial color="#5a5040" roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh position={[2.2, 2.4, 10.74]}>
        <boxGeometry args={[0.4, 0.5, 0.04]} />
        <meshPhysicalMaterial color="#b8d8ee" roughness={0.3} transparent opacity={0.4} />
      </mesh>
      {/* door */}
      <mesh position={[3.5, 1.3, 10.74]} castShadow>
        <boxGeometry args={[0.7, 1.4, 0.04]} />
        <meshPhysicalMaterial color="#4a3020" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* roof with procedural shingle texture */}
      <mesh position={[3.5, 4.15, 7.85]} rotation={[0.62, 0, 0]} castShadow>
        <boxGeometry args={[7.4, 0.14, 3.4]} />
        <meshPhysicalMaterial map={roofMat} color="#4a4a4a" roughness={0.85} bumpMap={roofMat} bumpScale={0.02} />
      </mesh>
      {/* roof ridge cap */}
      <mesh position={[3.5, 4.55, 7.0]} rotation={[0.62, 0, 0]}>
        <boxGeometry args={[7.4, 0.08, 0.2]} />
        <meshPhysicalMaterial color="#2a2a2a" roughness={0.9} />
      </mesh>
      {/* fascia board along eave */}
      <mesh position={[3.5, 3.6, 6.82]} castShadow>
        <boxGeometry args={[7.6, 0.22, 0.12]} />
        <meshPhysicalMaterial color="#e8e0d0" roughness={0.7} />
      </mesh>
      {/* U-profile gutter: bottom */}
      <mesh position={[3.5, 3.4, 6.85]} castShadow>
        <boxGeometry args={[7.4, 0.06, 0.3]} />
        <meshPhysicalMaterial color="#2b2b2b" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* gutter front face */}
      <mesh position={[3.5, 3.51, 7.0]}>
        <boxGeometry args={[7.4, 0.16, 0.02]} />
        <meshPhysicalMaterial color="#333333" roughness={0.3} metalness={0.5} />
      </mesh>
      {/* downspout with band details */}
      <group position={[0.45, 1.85, 6.8]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.11, 0.11, 3.3, 16]} />
          <meshPhysicalMaterial color="#1c1c1c" roughness={0.5} metalness={0.7} anisotropy={0.6} />
        </mesh>
        {/* connector bands */}
        {[0.3, 1.2, 2.1, 3.0].map((yOff) => (
          <mesh key={yOff} position={[0, -1.65 + yOff, 0]}>
            <cylinderGeometry args={[0.125, 0.125, 0.06, 16]} />
            <meshPhysicalMaterial color="#444" roughness={0.4} metalness={0.5} />
          </mesh>
        ))}
      </group>
      {/* downspout elbow at grade */}
      <mesh position={[0.35, 0.2, 6.3]} rotation={[Math.PI / 2, 0, 0.3]}>
        <cylinderGeometry args={[0.11, 0.11, 0.8, 16]} />
        <meshPhysicalMaterial color="#1c1c1c" roughness={0.5} metalness={0.7} />
      </mesh>
      {/* elbow connector band */}
      <mesh position={[0.37, 0.2, 6.55]} rotation={[0, Math.PI / 2, 0.15]}>
        <torusGeometry args={[0.12, 0.02, 8, 16]} />
        <meshPhysicalMaterial color="#444" roughness={0.4} metalness={0.5} />
      </mesh>
    </group>
  );
}

/* ===================================================================
   PHASE 2 + 3 — French Drains (improved materials, pipe detail)
   =================================================================== */

function FrenchDrain() {
  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.2, 0.1, 5.6),
        new THREE.Vector3(-1.4, 0.08, 3.8),
        new THREE.Vector3(1.3, 0.08, 2.0),
        new THREE.Vector3(-0.6, 0.06, 0.2),
        new THREE.Vector3(0, 0.02, -1.0),
      ]),
    []
  );

  // rock instances — use 3 varied geometries
  const rockGeos = useMemo(() => [
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.DodecahedronGeometry(1, 1),
  ], []);

  const gravel = useMemo(
    () =>
      Array.from({ length: 70 }, () => {
        const u = Math.random();
        const p = curve.getPoint(u);
        const shade = 0.4 + Math.random() * 0.4;
        const hueShift = (Math.random() - 0.5) * 0.05;
        return {
          position: [p.x + THREE.MathUtils.randFloatSpread(0.55), 0.06 + Math.random() * 0.12, p.z + THREE.MathUtils.randFloatSpread(0.4)],
          scale: THREE.MathUtils.randFloat(0.04, 0.12),
          rotation: [Math.random() * 3, Math.random() * 3, 0],
          color: new THREE.Color().setHSL(0.08 + hueShift, 0.1, shade),
          geoIdx: Math.floor(Math.random() * 3),
        };
      }),
    [curve]
  );

  return (
    <group>
      {/* geotextile fabric outer wrap */}
      <mesh>
        <tubeGeometry args={[curve, 60, 0.36, 10, false]} />
        <meshPhysicalMaterial
          color="#1a1a1a"
          roughness={0.95}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* corrugated perf pipe */}
      <mesh>
        <tubeGeometry args={[curve, 60, 0.16, 8, false]} />
        <meshPhysicalMaterial
          color="#1c1c1c"
          roughness={0.75}
          metalness={0.3}
        />
      </mesh>
      {/* corrugation rings */}
      {[0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((u) => {
        const p = curve.getPoint(u);
        return (
          <mesh key={u} position={p}>
            <torusGeometry args={[0.16, 0.015, 6, 12]} />
            <meshPhysicalMaterial color="#222" roughness={0.6} metalness={0.4} />
          </mesh>
        );
      })}
      {/* gravel bed */}
      {gravel.map((g, i) => (
        <mesh key={i} position={g.position} rotation={g.rotation} scale={g.scale} geometry={rockGeos[g.geoIdx]}>
          <meshPhysicalMaterial color={g.color} roughness={0.92} metalness={0.0} />
        </mesh>
      ))}
    </group>
  );
}

/* ===================================================================
   PHASE 2 + 3 + 4 — Catch Basin + Sump Pump (animated water + glow)
   =================================================================== */

function CatchBasinAndPump({ clockRef }) {
  const waterRef = useRef();
  const waterSurfaceRef = useRef();
  const light = useRef();
  const pumpMat = useRef();
  const vortexRot = useRef(0);

  useFrame(() => {
    const t = clockRef.current.t;
    const fill = THREE.MathUtils.smoothstep(t, 6.8, 8.2);
    const drain = THREE.MathUtils.smoothstep(t, 8.4, 9.6);
    const pumpOn = t >= 8.0 && t < 9.9;
    const level = THREE.MathUtils.lerp(-0.85, -0.3, fill * (1 - drain * 0.85));

    if (waterRef.current) {
      waterRef.current.position.y = level;
      waterRef.current.material.opacity = THREE.MathUtils.lerp(0.4, 0.85, fill);
    }

    // water surface with wobble
    if (waterSurfaceRef.current) {
      waterSurfaceRef.current.position.y = level + 0.06;
      const wobble = Math.sin(t * 4) * 0.005 * (1 - drain);
      waterSurfaceRef.current.position.y += wobble;
    }

    // pump indicator
    if (pumpMat.current) {
      pumpMat.current.color.set(pumpOn ? "#2ecc71" : "#c0392b");
      pumpMat.current.emissive.set(pumpOn ? "#2ecc71" : "#3d0f0a");
      pumpMat.current.emissiveIntensity = pumpOn ? 2.2 : 0.4;
    }
    if (light.current) light.current.intensity = pumpOn ? 2.5 + Math.sin(t * 20) * 0.5 : 0;

    // vortex rotation when pump runs
    if (pumpOn) {
      vortexRot.current += 0.08;
    }
  });

  const slots = useMemo(() => {
    const s = [];
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) s.push([x * 0.16, 0.06, z * 0.16]);
    return s;
  }, []);

  return (
    <group position={[0, 0, -1.2]}>
      {/* basin body — cut open */}
      <mesh position={[0, -0.55, 0]}>
        <boxGeometry args={[1.1, 1.1, 1.1]} />
        <meshPhysicalMaterial
          color="#111111"
          roughness={0.6}
          metalness={0.2}
          transparent
          opacity={0.35}
        />
      </mesh>
      {/* basin interior walls */}
      <mesh position={[0, -0.55, -0.01]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1.05, 1.05]} />
        <meshPhysicalMaterial color="#0a0a0a" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* basin water volume */}
      <mesh ref={waterRef} position={[0, -0.85, 0]}>
        <boxGeometry args={[0.95, 0.1, 0.95]} />
        <meshPhysicalMaterial
          color="#4db8ff"
          emissive="#1f6fb2"
          emissiveIntensity={0.8}
          transparent
          opacity={0.5}
          roughness={0.0}
          metalness={0.0}
          envMapIntensity={0.6}
        />
      </mesh>
      {/* water surface with fresnel */}
      <mesh ref={waterSurfaceRef} position={[0, -0.79, 0]}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshPhysicalMaterial
          color="#7fcfff"
          transparent
          opacity={0.5}
          roughness={0.0}
          metalness={0.0}
          envMapIntensity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* green grate */}
      <RoundedBox position={[0, 0.04, 0]} args={[1.0, 0.08, 1.0]} radius={0.03}>
        <meshPhysicalMaterial color="#6f9f70" roughness={0.55} metalness={0.1} />
      </RoundedBox>
      {slots.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[0.09, 0.06, 0.09]} />
          <meshPhysicalMaterial color="#22351f" roughness={0.8} />
        </mesh>
      ))}
      {/* sump pump body */}
      <mesh position={[0.32, -0.85, 0.3]}>
        <cylinderGeometry args={[0.14, 0.16, 0.35, 20]} />
        <meshPhysicalMaterial color="#333" roughness={0.4} metalness={0.4} />
      </mesh>
      {/* pump discharge pipe */}
      <mesh position={[0.32, -0.7, 0.3]}>
        <cylinderGeometry args={[0.04, 0.04, 0.12, 8]} />
        <meshPhysicalMaterial color="#ddd" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* pump indicator LED */}
      <mesh position={[0.32, -0.6, 0.3]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshPhysicalMaterial ref={pumpMat} color="#c0392b" emissive="#3d0f0a" emissiveIntensity={0.4} roughness={0.3} />
      </mesh>
      {/* pump glow light */}
      <pointLight ref={light} position={[0.32, -0.5, 0.3]} color="#2ecc71" intensity={0} distance={3} />
    </group>
  );
}

/* ===================================================================
   PHASE 2 + 3 + 4 — PVC, Curb, Street (detailed + splash)
   =================================================================== */

function PvcCurbStreet({ clockRef }) {
  const splash = useRef();

  const asphaltTex = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#3c3c40";
    ctx.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 300; i++) {
      const shade = 50 + Math.random() * 40;
      ctx.fillStyle = `rgb(${shade}, ${shade-2}, ${shade+3})`;
      ctx.fillRect(Math.random() * 128, Math.random() * 64, 1 + Math.random() * 2, 1);
    }
    // crack lines
    ctx.strokeStyle = "rgba(60, 55, 50, 0.3)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 128, Math.random() * 64);
      ctx.lineTo(Math.random() * 128, Math.random() * 64);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 2);
    return tex;
  }, []);

  useFrame(() => {
    const t = clockRef.current.t;
    const s = THREE.MathUtils.smoothstep(t, 9.3, 10);
    if (splash.current) {
      splash.current.scale.setScalar(0.2 + s * 1.8);
      splash.current.material.opacity = s > 0 ? (1 - s) * 0.9 : 0;
    }
  });

  return (
    <group>
      {/* PVC pipe from basin to curb — with slight translucency */}
      <mesh position={[0, -0.4, -4.1]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 3.4, 20]} />
        <meshPhysicalMaterial
          color="#eeeeee"
          roughness={0.3}
          metalness={0.0}
          clearcoat={0.8}
          clearcoatRoughness={0.2}
          envMapIntensity={0.3}
        />
      </mesh>
      {/* PVC outlet past curb */}
      <mesh position={[0, 0.05, -6.5]} rotation={[Math.PI / 2.6, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.9, 20]} />
        <meshPhysicalMaterial
          color="#eeeeee"
          roughness={0.3}
          clearcoat={0.8}
          clearcoatRoughness={0.2}
          envMapIntensity={0.3}
        />
      </mesh>
      {/* PVC coupling band */}
      <mesh position={[0, -0.1, -4.9]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.08, 16]} />
        <meshPhysicalMaterial color="#ccc" roughness={0.4} metalness={0.2} />
      </mesh>
      {/* curb with beveled top */}
      <mesh position={[0, 0.15, -6.3]} castShadow>
        <boxGeometry args={[16, 0.3, 0.35]} />
        <meshPhysicalMaterial color="#9a9a9a" roughness={0.85} />
      </mesh>
      {/* curb bevel (subtle rounding via a small wedge) */}
      <mesh position={[0, 0.3, -6.12]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[16, 0.04, 0.1]} />
        <meshPhysicalMaterial color="#aaa" roughness={0.8} />
      </mesh>
      {/* curb expansion joints */}
      {[-6, -3, 0, 3, 6].map((x) => (
        <mesh key={x} position={[x, 0.15, -6.3]} castShadow>
          <boxGeometry args={[0.04, 0.3, 0.36]} />
          <meshPhysicalMaterial color="#888" roughness={0.9} />
        </mesh>
      ))}
      {/* street with asphalt texture */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -8.4]}>
        <planeGeometry args={[16, 4]} />
        <meshPhysicalMaterial map={asphaltTex} color="#3c3c40" roughness={0.9} metalness={0.0} />
      </mesh>
      {/* splash ring */}
      <mesh ref={splash} position={[0, 0.06, -7.4]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.48, 48]} />
        <meshBasicMaterial color="#9fdcff" transparent opacity={0} />
      </mesh>
    </group>
  );
}

/* ===================================================================
   PHASE 2 — Yard (textured ground plane)
   =================================================================== */

function Yard() {
  const grassTex = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#5a8240";
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const shade = 60 + Math.random() * 50;
      const g = Math.round(shade * 0.8 + 30);
      ctx.fillStyle = `rgb(${Math.round(shade * 0.6)}, ${g}, ${Math.round(shade * 0.3)})`;
      ctx.fillRect(x, y, 0.5 + Math.random(), 1 + Math.random() * 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    return tex;
  }, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 2]} receiveShadow>
      <planeGeometry args={[18, 18]} />
      <meshPhysicalMaterial map={grassTex} color="#6f974b" roughness={0.95} metalness={0.0} envMapIntensity={0.1} />
    </mesh>
  );
}

/* ===================================================================
   PHASE 1 — Volumetric Fog (custom shader mesh)
   =================================================================== */

function VolumetricFog() {
  const fogMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#7b93a3") },
        uDensity: { value: 0.015 },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uDensity;
        uniform float uTime;
        varying vec3 vWorldPos;
        void main() {
          float dist = length(vWorldPos - cameraPosition);
          float fog = 1.0 - exp(-uDensity * dist * dist);
          // noise-like variation
          float n = sin(vWorldPos.x * 0.3 + uTime * 0.05) *
                    cos(vWorldPos.z * 0.3 + uTime * 0.04) * 0.5 + 0.5;
          fog *= 0.7 + n * 0.3;
          gl_FragColor = vec4(uColor, fog * 0.3);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    });
  }, []);

  useFrame(({ clock }) => {
    fogMat.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh>
      <sphereGeometry args={[28, 32, 32]} />
      <primitive object={fogMat} attach="material" />
    </mesh>
  );
}

/* ===================================================================
   PHASE 1 — Bounce Cards (emissive planes that kick light into shadows)
   =================================================================== */

function BounceCards() {
  return (
    <group>
      {/* warm bounce from ground toward house underside */}
      <mesh position={[0, -0.3, 4]} rotation={[-0.6, 0, 0]}>
        <planeGeometry args={[6, 4]} />
        <meshBasicMaterial color="#8a7a50" toneMapped={false} />
      </mesh>
      {/* cool fill from sky side */}
      <mesh position={[6, 3, 3]} rotation={[0.3, -0.5, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshBasicMaterial color="#7090a0" toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ===================================================================
   PHASE 1 — Scene Lighting
   =================================================================== */

function SceneLighting() {
  return (
    <>
      {/* key area light — warm, soft */}
      <rectAreaLight
        position={[-4, 8, 6]}
        rotation={[0.4, 0.6, 0]}
        width={3}
        height={5}
        intensity={8}
        color="#ffdaa0"
        castShadow
      />
      {/* fill light — cool, ambient */}
      <rectAreaLight
        position={[6, 5, 10]}
        rotation={[0.1, -0.4, 0]}
        width={4}
        height={3}
        intensity={3}
        color="#b0d0e0"
      />
      {/* back rim light */}
      <rectAreaLight
        position={[-3, 4, -5]}
        rotation={[0.2, 1.0, 0]}
        width={2}
        height={4}
        intensity={4}
        color="#d0e0f0"
      />
      {/* ambient fill from ground */}
      <ambientLight intensity={0.3} color="#8a7a50" />
      {/* warm top fill */}
      <hemisphereLight args={["#cfe3ee", "#4a5e3a", 0.4]} />
    </>
  );
}

/* ===================================================================
   PHASE 3 — Background Elements (distant trees via billboards)
   =================================================================== */

function BackgroundTrees() {
  const trees = useMemo(() => {
    const t = [];
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 8;
      t.push({
        position: [
          Math.cos(angle) * dist + 1,
          -0.5 + Math.random() * 0.3,
          Math.sin(angle) * dist + 3,
        ],
        scale: 1.5 + Math.random() * 2,
        shade: 0.3 + Math.random() * 0.25,
      });
    }
    return t;
  }, []);

  const treeMat = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    // trunk
    ctx.fillStyle = "#3a2a1a";
    ctx.fillRect(28, 40, 8, 56);
    // canopy blob
    ctx.fillStyle = "#2a5a2a";
    ctx.beginPath();
    ctx.ellipse(32, 24, 20, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a4a1a";
    ctx.beginPath();
    ctx.ellipse(24, 30, 14, 20, 0.3, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }, []);

  return (
    <group>
      {trees.map((t, i) => (
        <mesh
          key={i}
          position={t.position}
          scale={t.scale}
          rotation={[0, Math.random() * Math.PI, 0]}
        >
          <planeGeometry args={[2, 3]} />
          <meshBasicMaterial
            map={treeMat}
            transparent
            opacity={0.6}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ===================================================================
   PHASE 1 — Custom Environment (warm overcast with soft lightformers)
   =================================================================== */

function StudioEnvironment() {
  return (
    <Suspense fallback={null}>
      <Environment preset="city">
        <Lightformer
          position={[-5, 8, 5]}
          scale={[6, 3, 1]}
          intensity={1.5}
          color="#ffe0b0"
          form="rect"
        />
        <Lightformer
          position={[6, 4, 8]}
          scale={[4, 2, 1]}
          intensity={0.8}
          color="#c0d8e8"
          form="rect"
        />
        <Lightformer
          position={[0, 10, -8]}
          scale={[10, 1, 1]}
          intensity={0.6}
          color="#e0d0b0"
          form="rect"
        />
      </Environment>
    </Suspense>
  );
}

/* ===================================================================
   PHASE 5 — Post-Processing (Bloom + DOF + Vignette + ToneMapping)
   =================================================================== */

function DofTargetUpdater({ clockRef, dofTarget }) {
  const CAM_TARGETS = CAMERA_KEYS.map((k) => new THREE.Vector3(...k.tgt));
  useFrame(({ camera }) => {
    // maintain a lookahead target: where the camera is looking at + some offset forward
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dofTarget.current.copy(camera.position).add(dir.multiplyScalar(4));
  });
  return null;
}

function Effects({ dofTarget }) {
  return (
    <EffectComposer disableNormalPass multisampling={4}>
      <Bloom
        mipmapBlur
        intensity={0.95}
        luminanceThreshold={0.55}
        luminanceSmoothing={0.35}
        radius={0.95}
        kernelSize={KernelSize.LARGE}
      />
      <DepthOfField
        target={dofTarget.current}
        focalLength={0.018}
        bokehScale={2.6}
        height={520}
      />
      <Vignette
        eskil={false}
        offset={0.28}
        darkness={0.55}
      />
      <ToneMapping
        mode={THREE.ACESFilmicToneMapping}
        exposure={0.95}
      />
    </EffectComposer>
  );
}

/* ===================================================================
   Progress driver — must be rendered *inside* <Canvas> so useFrame is valid.
   Handles both scroll-ref and static progress props for the 3D timeline.
   =================================================================== */
function ProgressDriver({ progressRef, progress, clockRef }) {
  useFrame(() => {
    const hasLive = progressRef && typeof progressRef.current === 'number';
    const hasStatic = typeof progress === 'number';

    if (hasLive) {
      clockRef.current.t = (progressRef.current * DURATION) % DURATION;
    } else if (hasStatic) {
      clockRef.current.t = (progress * DURATION) % DURATION;
    }
  });
  return null;
}

/* ===================================================================
   MAIN COMPONENT
   =================================================================== */

const RainJourney3D = forwardRef(function RainJourney3D({ showCaptions = true, progress, progressRef }, ref) {
  const clockRef = useRef({ t: 0 });
  const glRef = useRef();
  const [phase, setPhase] = useState(0);
  const shakeIntensity = useRef(0);
  const dofTarget = useRef(new THREE.Vector3(0, 3, 6));

  useImperativeHandle(ref, () => ({
    getGl: () => glRef.current,
    restart: () => { clockRef.current.t = 0; },
    getClockRef: () => clockRef,
  }));

  const onCanvasCreated = useCallback(({ gl }) => {
    glRef.current = gl;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas
        data-testid="rain-journey-canvas"
        shadows
        dpr={[1, 2]}
        camera={{ position: [9, 6.5, 14], fov: 50, near: 0.1, far: 40 }}
        onCreated={onCanvasCreated}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <color attach="background" args={["#7b93a3"]} />
        <fog attach="fog" args={["#7b93a3", 14, 28]} />

        {/* PHASE 1: Lighting */}
        <SceneLighting />
        <BounceCards />
        <VolumetricFog />
        <StudioEnvironment />

        {/* PHASE 6: Camera + Shake + DOF Track */}
        <TimelineDriver clockRef={clockRef} onPhase={setPhase} externalProgress={!!(progressRef || progress)} />
        <ProgressDriver progressRef={progressRef} progress={progress} clockRef={clockRef} />
        <CameraRig clockRef={clockRef} shakeIntensity={shakeIntensity} />
        <ShakeTracker clockRef={clockRef} shakeIntensity={shakeIntensity} />
        <DofTargetUpdater clockRef={clockRef} dofTarget={dofTarget} />

        {/* SCENE */}
        <Yard />
        <BackgroundTrees />
        <HouseGutterDownspout />
        <FrenchDrain />
        <CatchBasinAndPump clockRef={clockRef} />
        <PvcCurbStreet clockRef={clockRef} />

        {/* PHASE 4: Water */}
        <Rain clockRef={clockRef} count={90} />
        <WaterPackets clockRef={clockRef} />
        <RoofWaterFlow clockRef={clockRef} />
        <DownspoutSpiral clockRef={clockRef} />
        <DischargeSplash clockRef={clockRef} />

        {/* shadows */}
        <ContactShadows position={[0, 0.005, 2]} opacity={0.25} scale={20} blur={3} far={6} />

        {/* PHASE 5: Post-Processing */}
        <Effects dofTarget={dofTarget.current} />
      </Canvas>

      {/* Phase caption overlay */}
      {showCaptions && (
        <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              data-testid="rain-journey-caption"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
              className="rounded-full font-medium"
              style={{ background: "rgba(10, 20, 30, 0.72)", color: "#e8f4ff", padding: "10px 22px", fontSize: 15, letterSpacing: 0.3 }}
            >
              {PHASES[phase].label}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
});

export default RainJourney3D;
