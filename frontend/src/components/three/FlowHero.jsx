import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, Float } from "@react-three/drei";
import * as THREE from "three";

/* --- Curves: elegant flowing paths sweeping diagonally across the frame --- */
function buildCurve(offsetY, offsetZ, amp) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const x = -7 + (i / 6) * 14;
    const y = offsetY + Math.sin(i * 0.9 + offsetY) * amp;
    const z = offsetZ + Math.cos(i * 0.6) * amp * 0.6;
    pts.push(new THREE.Vector3(x, y, z));
  }
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

/* Bright flowing core = the controlled fluid / energy path */
function FlowCore({ curve }) {
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 220, 0.17, 18, false), [curve]);
  const mat = useRef();
  useFrame((s) => {
    if (mat.current) mat.current.emissiveIntensity = 4.5 + Math.sin(s.clock.elapsedTime * 1.4) * 1.6;
  });
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial ref={mat} color="#ffc07a" emissive="#F57C1F" emissiveIntensity={5} toneMapped={false} />
    </mesh>
  );
}

/* Protective metal guard-rings threaded along the flow = the channel structure */
function GuardRings({ curve, count = 16 }) {
  const frames = useMemo(() => {
    const arr = [];
    const z = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const pos = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(z, tan);
      arr.push({ pos, quat });
    }
    return arr;
  }, [curve, count]);

  return (
    <>
      {frames.map((f, i) => (
        <mesh key={i} position={f.pos} quaternion={f.quat}>
          <torusGeometry args={[0.36, 0.07, 14, 30]} />
          <meshStandardMaterial color="#8093b4" metalness={1} roughness={0.28} envMapIntensity={2.6} />
        </mesh>
      ))}
    </>
  );
}

/* Emissive pulses that travel through the flow */
function FlowPulses({ curve, count = 4, speed = 0.06, reduced }) {
  const refs = useRef([]);
  useFrame((state) => {
    const base = reduced ? 0.5 : (state.clock.elapsedTime * speed) % 1;
    for (let i = 0; i < count; i++) {
      const t = (base + i / count) % 1;
      const p = curve.getPointAt(t);
      const m = refs.current[i];
      if (m) {
        m.position.copy(p);
        m.scale.setScalar(0.8 + Math.sin(t * Math.PI) * 0.9);
      }
    }
  });
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)}>
          <sphereGeometry args={[0.3, 20, 20]} />
          <meshStandardMaterial color="#fff2e0" emissive="#F57C1F" emissiveIntensity={9} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/* Smoked-glass protective shield form behind the flow */
function ShieldPanel() {
  return (
    <Float speed={1.2} rotationIntensity={0.12} floatIntensity={0.4}>
      <mesh position={[2.4, 0.6, -1.4]} rotation={[0, -0.5, 0.08]}>
        <boxGeometry args={[2.8, 3.8, 0.06]} />
        <meshPhysicalMaterial transmission={0.9} thickness={0.6} roughness={0.15} ior={1.4} color="#22335e" metalness={0} transparent opacity={0.8} />
      </mesh>
    </Float>
  );
}

/* Camera drift + mouse parallax */
function Rig({ reduced }) {
  const vec = new THREE.Vector3();
  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    const px = state.pointer.x * 0.7;
    const py = state.pointer.y * 0.45;
    vec.set(px + Math.sin(t * 0.15) * 0.4, 0.5 + py + Math.cos(t * 0.12) * 0.2, 8);
    state.camera.position.lerp(vec, 0.045);
    state.camera.lookAt(0.4, 0.3, 0);
  });
  return null;
}

function Scene({ reduced }) {
  const group = useRef();
  const curves = useMemo(
    () => [buildCurve(1.4, 0.2, 0.55), buildCurve(0.4, -0.3, 0.8), buildCurve(-0.7, 0.4, 0.6)],
    []
  );

  useFrame((state, delta) => {
    if (group.current && !reduced) group.current.rotation.y += delta * 0.018;
  });

  return (
    <>
      <fog attach="fog" args={["#0B0F1A", 15, 34]} />
      <hemisphereLight intensity={0.6} color="#9fb4d8" groundColor="#0B0F1A" />
      <ambientLight intensity={0.4} />
      <directionalLight position={[6, 7, 5]} intensity={2.2} color="#dce8ff" />
      <spotLight position={[-6, 3, 4]} angle={0.6} penumbra={1} intensity={120} color="#F57C1F" distance={34} />
      <pointLight position={[5, -2, 3]} intensity={50} color="#5a7cff" distance={24} />

      <group ref={group} position={[0.6, 0.6, 0]} rotation={[0.08, -0.32, -0.12]} scale={1.15}>
        {curves.map((c, i) => (
          <group key={i}>
            <FlowCore curve={c} />
            <GuardRings curve={c} count={16} />
            <FlowPulses curve={c} count={4} speed={0.05 + i * 0.015} reduced={reduced} />
          </group>
        ))}
        <ShieldPanel />
      </group>

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={3} position={[0, 5, -6]} scale={[14, 5, 1]} color="#aebfdc" />
        <Lightformer form="rect" intensity={5} position={[-6, 2, 3]} scale={[4, 8, 1]} color="#F57C1F" />
        <Lightformer form="rect" intensity={3} position={[6, 0, 4]} scale={[4, 8, 1]} color="#5a7cff" />
        <Lightformer form="ring" intensity={2} position={[0, 2, 5]} scale={5} color="#ffffff" />
      </Environment>

      <Rig reduced={reduced} />
    </>
  );
}

export default function FlowHero() {
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <Canvas
      data-testid="hero-3d-canvas"
      dpr={[1, 1.75]}
      camera={{ position: [0.4, 0.5, 8], fov: 42 }}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: true, preserveDrawingBuffer: true }}
      style={{ background: "transparent" }}
      frameloop={reduced ? "demand" : "always"}
    >
      <Scene reduced={reduced} />
    </Canvas>
  );
}
