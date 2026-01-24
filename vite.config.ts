import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
	plugins: [
		sveltekit(),
		viteStaticCopy({
			targets: [
				{
					src: 'node_modules/onnxruntime-web/dist/*.jsep.*',
					dest: 'wasm'
				}
			]
		})
	],
	server: {
        host: true,
        port: 5173,
        strictPort: true,
        proxy: {
    '/api': {
        target: 'http://127.0.0.1:8081', // Cambia localhost por 127.0.0.1
        changeOrigin: true,
        secure: false
    },
    '/ws': {
        target: 'ws://127.0.0.1:8081', // Asegúrate de que sea ws://
        ws: true
    }

        }
    },
	define: {
		APP_VERSION: JSON.stringify(process.env.npm_package_version),
		APP_BUILD_HASH: JSON.stringify(process.env.APP_BUILD_HASH || 'dev-build')
	},
	build: {
		sourcemap: true
	},
	worker: {
		format: 'es'
	}
});