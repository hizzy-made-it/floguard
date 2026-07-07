import { Suspense, forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, RoundedBox } from "@react-three/drei";
import { motion, AnimatePresence } from "framer-motion";
import * as THREE from "three";

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

function CameraRig({ clockRef }) {
  const pos = useMemo(() => new THREE.Vector3(), []);
  const tgt = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const t = clockRef.current.t;
    let i = 0;
    while (i < CAMERA_KEYS.length - 2 && t > CAMERA_KEYS[i + 1].t) i++;
    const a = CAMERA_KEYS[i];
    const b = CAMERA_KEYS[i + 1];
    const raw = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t || 1), 0, 1);
    const s = raw * raw * (3 - 2 * raw);
    pos.fromArray(a.pos).lerp(tgt.fromArray(b.pos), s);
    camera.position.copy(pos);
    pos.fromArray(a.tgt).lerp(tgt.fromArray(b.tgt), s);
    camera.lookAt(pos);
  });
  return null;
}

function TimelineDriver({ clockRef, onPhase }) {
  const lastPhase = useRef(-1);
  useFrame((_, delta) => {
    clockRef.current.t = (clockRef.current.t + delta) % DURATION;
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

function Rain({ count = 400 }) {
  const mesh = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const drops = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: THREE.MathUtils.randFloat(-7, 9),
        z: THREE.MathUtils.randFloat(-8, 11),
        y: THREE.MathUtils.randFloat(0, 13),
        speed: THREE.MathUtils.randFloat(8, 12),
      })),
    [count]
  );
  useFrame((_, delta) => {
    drops.forEach((d, i) => {
      d.y -= d.speed * delta;
      if (d.y < 0.1) d.y = 13;
      dummy.position.set(d.x, d.y, d.z);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[null, null, count]}>
      <boxGeometry args={[0.015, 0.35, 0.015]} />
      <meshBasicMaterial color="#bcd8ee" transparent opacity={0.55} />
    </instancedMesh>
  );
}

function WaterPackets({ clockRef, count = 9 }) {
  const refs = useRef([]);
  useFrame(() => {
    const t = clockRef.current.t;
    for (let i = 0; i < count; i++) {
      const m = refs.current[i];
      if (!m) continue;
      const tt = t - i * 0.14;
      const visible = tt > 0 && tt < DURATION;
      m.visible = visible;
      if (visible) m.position.copy(waterPositionAt(tt));
    }
  });
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)}>
          <sphereGeometry args={[0.11 - i * 0.006, 16, 16]} />
          <meshStandardMaterial color="#8fd6ff" emissive="#3aa7e8" emissiveIntensity={1.4} roughness={0.15} />
        </mesh>
      ))}
    </group>
  );
}

function HouseGutterDownspout() {
  return (
    <group>
      <mesh position={[3.5, 1.7, 9.2]} castShadow>
        <boxGeometry args={[7, 3.4, 3.2]} />
        <meshStandardMaterial color="#d8caa0" roughness={0.8} />
      </mesh>
      <mesh position={[3.5, 4.15, 7.85]} rotation={[0.62, 0, 0]} castShadow>
        <boxGeometry args={[7.4, 0.12, 3.2]} />
        <meshStandardMaterial color="#4a4a4a" roughness={0.9} />
      </mesh>
      <mesh position={[3.5, 3.5, 6.8]} castShadow>
        <boxGeometry args={[7.4, 0.22, 0.28]} />
        <meshStandardMaterial color="#2b2b2b" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0.45, 1.85, 6.8]} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 3.3, 16]} />
        <meshStandardMaterial color="#1c1c1c" roughness={0.6} />
      </mesh>
      <mesh position={[0.35, 0.2, 6.3]} rotation={[Math.PI / 2, 0, 0.3]}>
        <cylinderGeometry args={[0.11, 0.11, 0.8, 16]} />
        <meshStandardMaterial color="#1c1c1c" roughness={0.6} />
      </mesh>
    </group>
  );
}

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
  const gravel = useMemo(
    () =>
      Array.from({ length: 160 }, () => {
        const u = Math.random();
        const p = curve.getPoint(u);
        return {
          position: [p.x + THREE.MathUtils.randFloatSpread(0.55), 0.12, p.z + THREE.MathUtils.randFloatSpread(0.4)],
          scale: THREE.MathUtils.randFloat(0.04, 0.1),
          rotation: [Math.random() * 3, Math.random() * 3, 0],
          shade: THREE.MathUtils.randFloat(0.55, 0.8),
        };
      }),
    [curve]
  );
  return (
    <group>
      <mesh>
        <tubeGeometry args={[curve, 60, 0.34, 10, false]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.95} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <tubeGeometry args={[curve, 60, 0.14, 8, false]} />
        <meshStandardMaterial color="#161616" roughness={0.7} />
      </mesh>
      {gravel.map((g, i) => (
        <mesh key={i} position={g.position} rotation={g.rotation} scale={g.scale}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={new THREE.Color().setHSL(0, 0, g.shade)} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function CatchBasinAndPump({ clockRef }) {
  const water = useRef();
  const light = useRef();
  const pumpMat = useRef();
  useFrame(() => {
    const t = clockRef.current.t;
    const fill = THREE.MathUtils.smoothstep(t, 6.8, 8.2);
    const drain = THREE.MathUtils.smoothstep(t, 8.4, 9.6);
    const level = THREE.MathUtils.lerp(-0.85, -0.3, fill * (1 - drain * 0.85));
    if (water.current) water.current.position.y = level;
    const pumpOn = t >= 8.0 && t < 9.9;
    if (pumpMat.current) {
      pumpMat.current.color.set(pumpOn ? "#2ecc71" : "#c0392b");
      pumpMat.current.emissive.set(pumpOn ? "#2ecc71" : "#3d0f0a");
      pumpMat.current.emissiveIntensity = pumpOn ? 2.2 : 0.4;
    }
    if (light.current) light.current.intensity = pumpOn ? 2.5 : 0;
  });
  const slots = useMemo(() => {
    const s = [];
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) s.push([x * 0.16, 0.06, z * 0.16]);
    return s;
  }, []);
  return (
    <group position={[0, 0, -1.2]}>
      <mesh position={[0, -0.55, 0]}>
        <boxGeometry args={[1.1, 1.1, 1.1]} />
        <meshStandardMaterial color="#111111" roughness={0.6} transparent opacity={0.45} />
      </mesh>
      <mesh ref={water} position={[0, -0.85, 0]}>
        <boxGeometry args={[0.95, 0.1, 0.95]} />
        <meshStandardMaterial color="#4db8ff" emissive="#1f6fb2" emissiveIntensity={0.8} transparent opacity={0.85} />
      </mesh>
      <RoundedBox position={[0, 0.04, 0]} args={[1.0, 0.08, 1.0]} radius={0.03}>
        <meshStandardMaterial color="#6f9f70" roughness={0.55} />
      </RoundedBox>
      {slots.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[0.09, 0.06, 0.09]} />
          <meshStandardMaterial color="#22351f" />
        </mesh>
      ))}
      <mesh position={[0.32, -0.85, 0.3]}>
        <cylinderGeometry args={[0.14, 0.16, 0.35, 16]} />
        <meshStandardMaterial color="#333" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0.32, -0.6, 0.3]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial ref={pumpMat} color="#c0392b" />
      </mesh>
      <pointLight ref={light} position={[0.32, -0.5, 0.3]} color="#2ecc71" intensity={0} distance={3} />
    </group>
  );
}

function PvcCurbStreet({ clockRef }) {
  const splash = useRef();
  useFrame(() => {
    const t = clockRef.current.t;
    const s = THREE.MathUtils.smoothstep(t, 9.3, 10);
    if (splash.current) {
      splash.current.scale.setScalar(0.2 + s * 1.6);
      splash.current.material.opacity = s > 0 ? (1 - s) * 0.9 : 0;
    }
  });
  return (
    <group>
      <mesh position={[0, -0.35, -4.1]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 3.4, 16]} />
        <meshStandardMaterial color="#eeeeee" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.05, -6.5]} rotation={[Math.PI / 2.6, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.9, 16]} />
        <meshStandardMaterial color="#eeeeee" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.15, -6.3]}>
        <boxGeometry args={[16, 0.3, 0.35]} />
        <meshStandardMaterial color="#9a9a9a" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -8.4]}>
        <planeGeometry args={[16, 4]} />
        <meshStandardMaterial color="#3c3c40" roughness={1} />
      </mesh>
      <mesh ref={splash} position={[0, 0.06, -7.4]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.42, 32]} />
        <meshBasicMaterial color="#9fdcff" transparent opacity={0} />
      </mesh>
    </group>
  );
}

function Yard() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 2]} receiveShadow>
      <planeGeometry args={[18, 18]} />
      <meshStandardMaterial color="#6f974b" roughness={1} />
    </mesh>
  );
}

const RainJourney3D = forwardRef(function RainJourney3D({ showCaptions = true }, ref) {
  const clockRef = useRef({ t: 0 });
  const glRef = useRef();
  const [phase, setPhase] = useState(0);

  useImperativeHandle(ref, () => ({
    getGl: () => glRef.current,
    restart: () => {
      clockRef.current.t = 0;
    },
  }));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas
        data-testid="rain-journey-canvas"
        shadows
        dpr={[1, 2]}
        camera={{ position: [9, 6.5, 14], fov: 50 }}
        onCreated={({ gl }) => (glRef.current = gl)}
        gl={{ preserveDrawingBuffer: true }}
      >
        <color attach="background" args={["#7b93a3"]} />
        <fog attach="fog" args={["#7b93a3", 18, 34]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[-5, 10, 4]} intensity={1.4} castShadow />
        <hemisphereLight args={["#cfe3ee", "#4a5e3a", 0.6]} />
        <TimelineDriver clockRef={clockRef} onPhase={setPhase} />
        <CameraRig clockRef={clockRef} />
        <Yard />
        <HouseGutterDownspout />
        <FrenchDrain />
        <CatchBasinAndPump clockRef={clockRef} />
        <PvcCurbStreet clockRef={clockRef} />
        <Rain />
        <WaterPackets clockRef={clockRef} />
        <ContactShadows position={[0, 0.005, 2]} opacity={0.3} scale={20} blur={2.5} far={5} />
        <Suspense fallback={null}>
          <Environment preset="city" />
        </Suspense>
      </Canvas>

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
