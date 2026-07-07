import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, Float } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

/* --- Curves: French drain tubing sweeping diagonally across the frame --- */
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

/* Rain water flowing through the tube — translucent blue core */
function WaterFlow({ curve }) {
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 240, 0.2, 18, false), [curve]);
  const mat = useRef();
  useFrame((s) => {
    if (mat.current) mat.current.emissiveIntensity = 1.4 + Math.sin(s.clock.elapsedTime * 1.6) * 0.6;
  });
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial
        ref={mat}
        color="#3aa7e8"
        emissive="#2f9fe0"
        emissiveIntensity={1.6}
        metalness={0.2}
        roughness={0.15}
        transparent
        opacity={0.92}
        toneMapped={false}
      />
    </mesh>
  );
}

/* Corrugated French drain pipe ribs threaded densely along the water path */
function CorrugatedPipe({ curve, count = 34 }) {
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
          <torusGeometry args={[0.3, 0.055, 12, 26]} />
          <meshStandardMaterial color="#1c2735" metalness={0.35} roughness={0.55} envMapIntensity={1.2} />
        </mesh>
      ))}
    </>
  );
}

/* Bright pulses of water surging through the tubing */
function WaterPulses({ curve, count = 4, speed = 0.06, reduced }) {
  const refs = useRef([]);
  useFrame((state) => {
    const base = reduced ? 0.5 : (state.clock.elapsedTime * speed) % 1;
    for (let i = 0; i < count; i++) {
      const t = (base + i / count) % 1;
      const p = curve.getPointAt(t);
      const m = refs.current[i];
      if (m) {
        m.position.copy(p);
        m.scale.setScalar(0.7 + Math.sin(t * Math.PI) * 0.8);
      }
    }
  });
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)}>
          <sphereGeometry args={[0.19, 18, 18]} />
          <meshStandardMaterial color="#dff3ff" emissive="#5cc4ff" emissiveIntensity={6} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/* Falling rain feeding the drain system */
function Rain({ count = 200, reduced }) {
  const ref = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const drops = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * 20,
        y: Math.random() * 14 - 3,
        z: (Math.random() - 0.5) * 9 - 1,
        speed: 7 + Math.random() * 7,
        len: 0.3 + Math.random() * 0.6,
      })),
    [count]
  );
  useFrame((_, delta) => {
    if (!ref.current) return;
    const dt = reduced ? 0 : Math.min(delta, 0.05);
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      d.y -= d.speed * dt;
      if (d.y < -4) d.y = 8 + Math.random() * 4;
      dummy.position.set(d.x, d.y, d.z);
      dummy.scale.set(1, d.len, 1);
      dummy.rotation.set(0, 0, 0.14);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <boxGeometry args={[0.014, 1, 0.014]} />
      <meshStandardMaterial color="#cfe9ff" emissive="#8fcbff" emissiveIntensity={1.4} transparent opacity={0.45} toneMapped={false} />
    </instancedMesh>
  );
}

/* Smoked-glass protective shield form behind the tubing */
function ShieldPanel() {
  return (
    <Float speed={1.2} rotationIntensity={0.12} floatIntensity={0.4}>
      <mesh position={[2.4, 0.6, -1.4]} rotation={[0, -0.5, 0.08]}>
        <boxGeometry args={[2.8, 3.8, 0.06]} />
        <meshPhysicalMaterial transmission={0.9} thickness={0.6} roughness={0.15} ior={1.4} color="#1f3358" metalness={0} transparent opacity={0.8} />
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
    if (group.current && !reduced) group.current.rotation.y += delta * 0.016;
  });

  return (
    <>
      <fog attach="fog" args={["#0B0F1A", 15, 34]} />
      <hemisphereLight intensity={0.6} color="#9fc4e8" groundColor="#0B0F1A" />
      <ambientLight intensity={0.4} />
      <directionalLight position={[6, 7, 5]} intensity={2.2} color="#dcefff" />
      <spotLight position={[-6, 4, 4]} angle={0.6} penumbra={1} intensity={110} color="#5cc4ff" distance={34} />
      <pointLight position={[5, -2, 3]} intensity={40} color="#F57C1F" distance={22} />

      <Rain count={200} reduced={reduced} />

      <group ref={group} position={[0.6, 0.6, 0]} rotation={[0.08, -0.32, -0.12]} scale={1.15}>
        {curves.map((c, i) => (
          <group key={i}>
            <WaterFlow curve={c} />
            <CorrugatedPipe curve={c} count={34} />
            <WaterPulses curve={c} count={4} speed={0.05 + i * 0.015} reduced={reduced} />
          </group>
        ))}
        <ShieldPanel />
      </group>

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={3} position={[0, 5, -6]} scale={[14, 5, 1]} color="#aecdec" />
        <Lightformer form="rect" intensity={5} position={[-6, 2, 3]} scale={[4, 8, 1]} color="#5cc4ff" />
        <Lightformer form="rect" intensity={2.4} position={[6, 0, 4]} scale={[4, 8, 1]} color="#F57C1F" />
        <Lightformer form="ring" intensity={2} position={[0, 2, 5]} scale={5} color="#ffffff" />
      </Environment>

      <Rig reduced={reduced} />

      <EffectComposer disableNormalPass>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.8} luminanceSmoothing={0.25} radius={0.7} />
      </EffectComposer>
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
