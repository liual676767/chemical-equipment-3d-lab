import { defineConfig, type Plugin } from 'vite';

const orbitModule = 'three/examples/jsm/controls/OrbitControls.js';

function orbitKeyboardDisposal(): Plugin {
  return {
    name: 'three-r160-orbit-keyboard-disposal',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replace(/\\/g, '/').split('?')[0].endsWith('/' + orbitModule)) return null;
      // Three r160 registers captured document key listeners for wheel gestures.
      const start = 'this.dispose = function () {';
      if (!source.includes(start) || !source.includes('function interceptControlDown(')) {
        throw new Error('OrbitControls source changed. Review the r160 keyboard disposal patch.');
      }
      return source.replace(start, start + `
			document.removeEventListener('keydown', interceptControlDown, true);
			document.removeEventListener('keyup', interceptControlUp, true);
`);
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [orbitKeyboardDisposal()],
  optimizeDeps: { exclude: [orbitModule] },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] }
      }
    }
  },
  server: { host: '127.0.0.1', port: 5173 }
});
