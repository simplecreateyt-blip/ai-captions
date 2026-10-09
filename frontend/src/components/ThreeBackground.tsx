"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Stars } from "@react-three/drei";
import * as THREE from "three";

function ParticleField() {
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 520;
    const values = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      values[offset] = (Math.random() - 0.5) * 24;
      values[offset + 1] = (Math.random() - 0.5) * 16;
      values[offset + 2] = (Math.random() - 0.5) * 12;
    }

    return values;
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y += delta * 0.012;
    pointsRef.current.rotation.x += delta * 0.004;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#71e7ee"
        size={0.035}
        transparent
        opacity={0.72}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

function SignalNodes() {
  return (
    <>
      <Float speed={0.45} rotationIntensity={0.12} floatIntensity={0.3}>
        <mesh position={[-5.5, 2.5, -3]}>
          <icosahedronGeometry args={[0.72, 1]} />
          <meshBasicMaterial color="#51d8e8" wireframe transparent opacity={0.18} />
        </mesh>
      </Float>
      <Float speed={0.35} rotationIntensity={0.16} floatIntensity={0.24}>
        <mesh position={[5.8, -2, -4]}>
          <octahedronGeometry args={[0.9, 0]} />
          <meshBasicMaterial color="#f064a6" wireframe transparent opacity={0.16} />
        </mesh>
      </Float>
    </>
  );
}

export default function ThreeBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 9], fov: 58 }}
        gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
        dpr={[1, 1.25]}
        frameloop="always"
      >
        <color attach="background" args={["#06080c"]} />
        <Stars radius={70} depth={36} count={1100} factor={2.1} saturation={0} fade speed={0.12} />
        <ParticleField />
        <SignalNodes />
      </Canvas>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_25%,transparent_0%,rgba(6,8,12,0.3)_52%,#06080c_100%)]" />
    </div>
  );
}