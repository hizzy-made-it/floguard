import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, Float } from "@react-three/drei";

function Shield() {
  const ref = useRef();
  useFrame((_, d) => {
    if (ref.current) {
      ref.current.rotation.y += d * 0.3;
      ref.current.rotation.x += d * 0.1;
    }
  });
  return (
    <Float speed={2} rotationIntensity={0.4} floatIntensity={0.6}>
      <mesh ref={ref}>
        <torusKnotGeometry args={[0.9, 0.28, 160, 24]} />
        <meshStandardMaterial color="#1E2A52" metalness={0.9} roughness={0.25} envMapIntensity={1.4} />
      </mesh>
    </Float>
  );
}

export default function MiniShield() {
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 4], fov: 45 }} frameloop={reduced ? "demand" : "always"}>
      <color attach="background" args={["#151C2C"]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[3, 3, 3]} intensity={20} color="#F57C1F" />
      <Shield />
      <Environment resolution={128}>
        <Lightformer form="rect" intensity={2} position={[-3, 2, 2]} scale={4} color="#F57C1F" />
        <Lightformer form="rect" intensity={1.5} position={[3, -1, 3]} scale={4} color="#4a6cff" />
      </Environment>
    </Canvas>
  );
}
