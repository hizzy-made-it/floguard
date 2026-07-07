import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows, RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";

function GravelBed({ count = 420 }) {
  const stones = useMemo(() => {
    return Array.from({ length: count }, () => {
      const z = THREE.MathUtils.randFloatSpread(17);
      const width = THREE.MathUtils.mapLinear(Math.abs(z), 0, 8.5, 1.05, 1.9);
      const x = THREE.MathUtils.randFloatSpread(width);
      const y = THREE.MathUtils.randFloat(0.05, 0.16);
      return {
        position: [x, y, z],
        rotation: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
        scale: [
          THREE.MathUtils.randFloat(0.05, 0.14),
          THREE.MathUtils.randFloat(0.03, 0.09),
          THREE.MathUtils.randFloat(0.05, 0.16),
        ],
        color: new THREE.Color().setHSL(0, 0, THREE.MathUtils.randFloat(0.55, 0.82)),
      };
    });
  }, [count]);
  return (
    <group>
      {stones.map((stone, i) => (
        <mesh key={i} position={stone.position} rotation={stone.rotation} scale={stone.scale} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={stone.color} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function CorrugatedPipe() {
  const rings = useMemo(
    () => Array.from({ length: 95 }, (_, i) => ({ z: -7.8 + i * 0.15, radius: i % 2 === 0 ? 0.19 : 0.22 })),
    []
  );
  return (
    <group position={[0, 0.25, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.18, 0.18, 14.5, 32]} />
        <meshStandardMaterial color="#111111" roughness={0.7} />
      </mesh>
      {rings.map((ring, i) => (
        <mesh key={i} position={[0, 0, ring.z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[ring.radius, 0.015, 8, 32]} />
          <meshStandardMaterial color="#1b1b1b" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function FabricWall({ side = 1 }) {
  const points = useMemo(
    () => [
      new THREE.Vector3(side * 1.05, 0, -8.7),
      new THREE.Vector3(side * 1.18, 0.2, -5.5),
      new THREE.Vector3(side * 1.28, 0.32, -2.5),
      new THREE.Vector3(side * 1.13, 0.35, 1.2),
      new THREE.Vector3(side * 1.36, 0.28, 4.7),
      new THREE.Vector3(side * 1.52, 0.16, 8.6),
    ],
    [side]
  );
  const curve = useMemo(() => new THREE.CatmullRomCurve3(points), [points]);
  return (
    <mesh castShadow receiveShadow>
      <tubeGeometry args={[curve, 80, 0.035, 6, false]} />
      <meshStandardMaterial color="#050505" roughness={0.85} />
    </mesh>
  );
}

function FabricSheet({ side = 1 }) {
  const shape = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const segments = 28;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const z = THREE.MathUtils.lerp(-8.7, 8.7, t);
      const waviness = Math.sin(t * Math.PI * 7) * 0.12;
      const lowerX = side * (0.9 + t * 0.45 + waviness);
      const upperX = side * (1.35 + t * 0.25 + waviness * 0.7);
      vertices.push(lowerX, 0.03, z);
      vertices.push(upperX, 0.9 - t * 0.35 + Math.sin(t * 12) * 0.1, z);
    }
    const indices = [];
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2);
      indices.push(a + 1, a + 3, a + 2);
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }, [side]);
  return (
    <mesh geometry={shape} castShadow receiveShadow>
      <meshStandardMaterial color="#080808" roughness={0.95} side={THREE.DoubleSide} />
    </mesh>
  );
}

function DrainGrate({ position = [0, 0.42, -6.6], scale = 1 }) {
  const slots = useMemo(() => {
    const result = [];
    for (let x = -3; x <= 3; x++) for (let z = -4; z <= 4; z++) result.push([x * 0.18, 0.035, z * 0.17]);
    return result;
  }, []);
  return (
    <group position={position} scale={scale} castShadow>
      <RoundedBox args={[1.55, 0.18, 1.25]} radius={0.08} smoothness={4}>
        <meshStandardMaterial color="#111111" roughness={0.6} />
      </RoundedBox>
      <RoundedBox position={[0, 0.1, 0]} args={[1.38, 0.08, 1.08]} radius={0.05}>
        <meshStandardMaterial color="#6f9f70" roughness={0.55} metalness={0.05} />
      </RoundedBox>
      {slots.map((slot, i) => (
        <RoundedBox key={i} position={slot} args={[0.095, 0.09, 0.09]} radius={0.02}>
          <meshStandardMaterial color="#22351f" roughness={0.8} />
        </RoundedBox>
      ))}
    </group>
  );
}

function DistantDumpTruck({ position = [-2.6, 0.35, 7.2], color = "#d9472f", label = "HI-MAX" }) {
  return (
    <group position={position} rotation={[0, 0.1, 0]} scale={0.55}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[1.2, 0.55, 0.9]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0.7, 0.55, 0]} rotation={[0, 0, -0.25]} castShadow>
        <boxGeometry args={[0.25, 0.9, 0.9]} />
        <meshStandardMaterial color="#111111" roughness={0.8} />
      </mesh>
      <mesh position={[-0.75, 0.28, 0]} castShadow>
        <boxGeometry args={[0.32, 0.3, 0.65]} />
        <meshStandardMaterial color="#202020" roughness={0.6} />
      </mesh>
      {[-0.45, 0.45].map((x) =>
        [-0.36, 0.36].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, -0.08, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.18, 0.12, 24]} />
            <meshStandardMaterial color="#161616" roughness={0.85} />
          </mesh>
        ))
      )}
      <Text position={[0, 0.66, -0.48]} rotation={[0, Math.PI, 0]} fontSize={0.16} color="white" anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  );
}

function GrassField() {
  const grass = useMemo(
    () =>
      Array.from({ length: 520 }, () => ({
        position: [THREE.MathUtils.randFloatSpread(12), 0.015, THREE.MathUtils.randFloatSpread(19)],
        rotation: [0, Math.random() * Math.PI, 0],
        scale: THREE.MathUtils.randFloat(0.4, 1),
      })),
    []
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[13, 20, 32, 32]} />
        <meshStandardMaterial color="#71994c" roughness={1} />
      </mesh>
      {grass.map((blade, i) => (
        <mesh key={i} position={blade.position} rotation={blade.rotation} scale={blade.scale}>
          <coneGeometry args={[0.012, 0.18, 3]} />
          <meshStandardMaterial color={i % 3 === 0 ? "#9bb866" : "#5d7d38"} />
        </mesh>
      ))}
    </group>
  );
}

function HouseAndDeck() {
  return (
    <group position={[4.2, 0, 4.1]} rotation={[0, -0.05, 0]}>
      <mesh position={[0, 1.25, 0]} receiveShadow castShadow>
        <boxGeometry args={[2.2, 2.5, 4]} />
        <meshStandardMaterial color="#d5c797" roughness={0.75} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[-1.12, 0.25 + i * 0.17, 0]}>
          <boxGeometry args={[0.04, 0.035, 4.1]} />
          <meshStandardMaterial color="#b8ab80" roughness={0.75} />
        </mesh>
      ))}
      <mesh position={[-0.8, 0.2, -2.55]} castShadow>
        <boxGeometry args={[2.1, 0.14, 1.25]} />
        <meshStandardMaterial color="#72563c" roughness={0.7} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[-1.65 + i * 0.32, 0.55, -2.55]} castShadow>
          <boxGeometry args={[0.05, 0.7, 0.05]} />
          <meshStandardMaterial color="#5a422e" roughness={0.75} />
        </mesh>
      ))}
    </group>
  );
}

function TreesBackground() {
  const trees = useMemo(
    () =>
      Array.from({ length: 25 }, () => ({
        x: THREE.MathUtils.randFloat(-6, 6),
        z: THREE.MathUtils.randFloat(7.5, 9.8),
        h: THREE.MathUtils.randFloat(1.5, 2.9),
        r: THREE.MathUtils.randFloat(0.35, 0.65),
      })),
    []
  );
  return (
    <group>
      {trees.map((tree, i) => (
        <group key={i} position={[tree.x, 0, tree.z]}>
          <mesh position={[0, tree.h / 2, 0]}>
            <cylinderGeometry args={[0.06, 0.08, tree.h, 8]} />
            <meshStandardMaterial color="#4e3424" />
          </mesh>
          <mesh position={[0, tree.h, 0]}>
            <coneGeometry args={[tree.r, tree.h * 1.2, 10]} />
            <meshStandardMaterial color={i % 2 === 0 ? "#2f5c35" : "#4f7357"} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function DrainageScene() {
  const group = useRef();
  useFrame(({ clock }) => {
    if (group.current) group.current.position.y = Math.sin(clock.elapsedTime * 0.4) * 0.015;
  });
  return (
    <group ref={group}>
      <GrassField />
      <group position={[0, 0, 0]}>
        <FabricSheet side={1} />
        <FabricSheet side={-1} />
        <FabricWall side={1} />
        <FabricWall side={-1} />
        <mesh position={[0, 0.02, 0]} receiveShadow>
          <boxGeometry args={[1.5, 0.05, 17.5]} />
          <meshStandardMaterial color="#5b5b5b" roughness={1} />
        </mesh>
        <GravelBed />
        <CorrugatedPipe />
        <DrainGrate position={[0, 0.48, -6.75]} scale={1.05} />
        <DrainGrate position={[0.02, 0.42, 1.3]} scale={0.45} />
      </group>
      <DistantDumpTruck position={[-2.6, 0.36, 7.1]} color="#d94a2f" label="HI-MAX" />
      <DistantDumpTruck position={[2.3, 0.36, 7.35]} color="#1f5ba8" label="MAX" />
      <HouseAndDeck />
      <TreesBackground />
    </group>
  );
}

export default function TrenchHero() {
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <Canvas
      data-testid="hero-3d-canvas"
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 3.2, -9.2], fov: 48, near: 0.1, far: 100 }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={["#c7df9d"]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[-4, 8, -4]} intensity={2.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        <hemisphereLight args={["#f5ffd8", "#536c3f", 0.75]} />
        <DrainageScene />
        <ContactShadows position={[0, -0.01, 0]} opacity={0.35} scale={16} blur={2.6} far={6} />
        <OrbitControls
          target={[0, 0.35, 0.4]}
          minPolarAngle={0.35}
          maxPolarAngle={1.45}
          enableZoom={false}
          enablePan={false}
          autoRotate={!reduced}
          autoRotateSpeed={0.35}
        />
      </Suspense>
    </Canvas>
  );
}
