"use client";

import React, { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Sphere } from "@react-three/drei";
import * as THREE from "three";

function FloatingConstellation() {
  const pointsRef = useRef<THREE.Points>(null);

  // Generate randomized particle positions
  const [positions, colors] = useMemo(() => {
    const count = 300;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    const cyan = new THREE.Color("#06b6d4");
    const violet = new THREE.Color("#8b5cf6");

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      pos[i3] = (Math.random() - 0.5) * 20;
      pos[i3 + 1] = (Math.random() - 0.5) * 14;
      pos[i3 + 2] = (Math.random() - 0.5) * 10;

      const mixed = cyan.clone().lerp(violet, Math.random());
      col[i3] = mixed.r;
      col[i3 + 1] = mixed.g;
      col[i3 + 2] = mixed.b;
    }

    return [pos, col];
  }, []);

  useFrame((state, delta) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.04;
      pointsRef.current.rotation.x += delta * 0.02;

      // React subtly to mouse pointer
      pointsRef.current.position.x = THREE.MathUtils.lerp(
        pointsRef.current.position.x,
        state.pointer.x * 1.2,
        0.05
      );
      pointsRef.current.position.y = THREE.MathUtils.lerp(
        pointsRef.current.position.y,
        state.pointer.y * 0.8,
        0.05
      );
    }
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
        <bufferAttribute
          attach="attributes-color"
          count={colors.length / 3}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        vertexColors
        transparent
        opacity={0.65}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

function GlowingShapes() {
  const meshRef1 = useRef<THREE.Mesh>(null);
  const meshRef2 = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (meshRef1.current) {
      meshRef1.current.rotation.x += delta * 0.15;
      meshRef1.current.rotation.y += delta * 0.2;
      meshRef1.current.position.x = THREE.MathUtils.lerp(
        meshRef1.current.position.x,
        -4 + state.pointer.x * 0.8,
        0.03
      );
    }
    if (meshRef2.current) {
      meshRef2.current.rotation.y += delta * 0.18;
      meshRef2.current.rotation.z += delta * 0.12;
      meshRef2.current.position.x = THREE.MathUtils.lerp(
        meshRef2.current.position.x,
        4.5 + state.pointer.x * -0.8,
        0.03
      );
    }
  });

  return (
    <>
      {/* Floating Torus Knot on Left */}
      <Float speed={2} rotationIntensity={0.8} floatIntensity={1.5}>
        <mesh ref={meshRef1} position={[-4, 1.5, -2]}>
          <torusKnotGeometry args={[1.2, 0.35, 96, 16]} />
          <meshStandardMaterial
            color="#8b5cf6"
            emissive="#4c1d95"
            emissiveIntensity={0.6}
            roughness={0.2}
            metalness={0.8}
            wireframe
          />
        </mesh>
      </Float>

      {/* Floating Icosahedron on Right */}
      <Float speed={1.8} rotationIntensity={1} floatIntensity={1.2}>
        <mesh ref={meshRef2} position={[4.5, -1, -3]}>
          <icosahedronGeometry args={[1.6, 1]} />
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#083344"
            emissiveIntensity={0.5}
            roughness={0.3}
            metalness={0.7}
            wireframe
          />
        </mesh>
      </Float>

      {/* Subtle deep floating ambient spheres */}
      <Float speed={1.2} floatIntensity={0.8}>
        <Sphere args={[0.5, 16, 16]} position={[-2, -3, -4]}>
          <meshStandardMaterial
            color="#ec4899"
            emissive="#831843"
            emissiveIntensity={0.8}
            roughness={0.1}
          />
        </Sphere>
      </Float>
    </>
  );
}

export default function ThreeCanvas() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-60">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 1.5]}
      >
        <ambientLight intensity={0.4} />
        {/* Neon Purple and Cyan Point Lights */}
        <pointLight position={[-6, 5, 4]} color="#a855f7" intensity={2.5} distance={16} />
        <pointLight position={[6, -4, 3]} color="#06b6d4" intensity={2.2} distance={16} />
        <directionalLight position={[0, 8, 5]} color="#ffffff" intensity={0.3} />

        <FloatingConstellation />
        <GlowingShapes />
      </Canvas>
    </div>
  );
}
