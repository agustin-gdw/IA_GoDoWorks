<script lang="ts">
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Plus from '$lib/components/icons/Plus.svelte';
	import { WEBUI_BASE_URL } from '$lib/constants';

	let selected = '';
</script>

<style>
	/* Estilos para logo grande y rectangular */
	.logo-agrandado {
		width: 70px !important;
		height: auto !important; /* Auto permite que sea rectangular */
		min-width: 70px !important;
		object-fit: contain !important;
	}
	
	/* Aseguramos que el contenedor sea lo suficientemente ancho */
	.sidebar-container {
		min-width: 100px !important;
	}
</style>

<div class="sidebar-container bg-gray-50 dark:bg-gray-950 flex gap-6 flex-col pt-8 h-full">
	<div class="flex justify-center relative">
		{#if selected === 'home'}
			<div class="absolute top-0 left-0 flex h-full">
				<div class="my-auto rounded-r-lg w-1.5 h-12 bg-black dark:bg-white"></div>
			</div>
		{/if}

		<Tooltip content="Home" placement="right">
			<button
				class="cursor-pointer {selected === 'home' ? 'rounded-2xl' : 'rounded-full'}"
				on:click={() => {
					selected = 'home';
					if (window.electronAPI) {
						window.electronAPI.load('home');
					}
				}}
			>
				<img
					src="https://raw.githubusercontent.com/agustin-gdw/IA_GoDoWorks/cee37eb2835262194239dd473d2f34d9ffa783fa/Favicon1%20(2).png"
					class="logo-agrandado dark:invert"
					alt="logo"
					draggable="false"
				/>
			</button>
		</Tooltip>
	</div>

	<div class="border-[1.5px] border-gray-100 dark:border-gray-900 mx-4"></div>

	<div class="flex justify-center relative group">
		{#if selected === ''}
			<div class="absolute top-0 left-0 flex h-full">
				<div class="my-auto rounded-r-lg w-1.5 h-12 bg-black dark:bg-white"></div>
			</div>
		{/if}
		<button
			class="cursor-pointer bg-transparent"
			on:click={() => {
				selected = '';
			}}
		>
			<img
				crossorigin="anonymous"
				src="https://raw.githubusercontent.com/agustin-gdw/IA_GoDoWorks/cee37eb2835262194239dd473d2f34d9ffa783fa/Favicon1%20(2).png"
				class="logo-agrandado"
				alt="GoDoWorks"
				draggable="false"
			/>
		</button>
	</div>
</div>