import * as THREE from 'three';
import type { CatalogPart } from './types';
import { buildPart } from './geometry';

export function workshopThumbnails() {
  const cache = new Map<string, string>();
  const pending = new Map<HTMLImageElement, CatalogPart>();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#edf2f7');
  scene.add(new THREE.HemisphereLight('#ffffff', '#71859f', 2));
  const light = new THREE.DirectionalLight('#ffffff', 2.6);
  light.position.set(4, 8, 6);
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(35, 1.5, 0.01, 150);
  let renderer: THREE.WebGLRenderer | undefined;
  let unavailable = false;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !(entry.target instanceof HTMLImageElement)) continue;
      const image = entry.target;
      const part = pending.get(image);
      observer.unobserve(image);
      pending.delete(image);
      if (!part || unavailable) continue;
      let url = cache.get(part.id);
      if (!url) {
        try {
          if (!renderer) {
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(108, 72);
          }
          const model = buildPart(part.id, part.defaultSpec, part.color, part.material);
          const bounds = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
          camera.position.copy(bounds.center).addScaledVector(new THREE.Vector3(1.4, 1.0, 1.8).normalize(), Math.max(0.2, bounds.radius * 3.7));
          camera.lookAt(bounds.center);
          scene.add(model);
          renderer.render(scene, camera);
          url = renderer.domElement.toDataURL();
          cache.set(part.id, url);
          scene.remove(model);
          const materials = new Set<THREE.Material>();
          model.traverse(object => {
            if (object instanceof THREE.Mesh) {
              for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
            }
          });
          materials.forEach(material => material.dispose());
        } catch {
          unavailable = !renderer;
        }
      }
      if (url) image.src = url;
    }
  });
  return {
    add(image: HTMLImageElement, part: CatalogPart) {
      pending.set(image, part);
      observer.observe(image);
    },
    reset() {
      observer.disconnect();
      pending.clear();
    },
    dispose() {
      observer.disconnect();
      pending.clear();
      renderer?.dispose();
      renderer?.forceContextLoss();
    }
  };
}
