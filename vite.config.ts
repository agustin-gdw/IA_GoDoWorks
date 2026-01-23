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
		// host: true permite que el sistema se vea en tu red local (192.168.5.46)
		host: true,
		port: 5173,
		strictPort: true,
		// Ya no necesitamos configuraciones especiales de hmr para ngrok
		hmr: {
			protocol: 'ws',
			host: 'localhost'
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