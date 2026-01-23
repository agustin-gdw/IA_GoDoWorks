<script>
	import { getContext, onMount } from 'svelte';
	const i18n = getContext('i18n');

	import Marquee from './common/Marquee.svelte';
	import SlideShow from './common/SlideShow.svelte';
	import ArrowRightCircle from './icons/ArrowRightCircle.svelte';

	export let show = true;
	export let getStartedHandler = () => {};

	// URLs de tus logos en GitHub (PNG)
	const LOGO_LIGHT = "https://raw.githubusercontent.com/agustin-gdw/IA_GoDoWorks/cee37eb2835262194239dd473d2f34d9ffa783fa/Favicon1%20(2).png";
	const LOGO_DARK = "https://raw.githubusercontent.com/agustin-gdw/IA_GoDoWorks/21f6b24619eb102117ec755e3738f9f452b4661c/Favicon2%20(1).png";

	// Establecemos el logo de modo claro como base inicial
	let activeLogo = LOGO_LIGHT;

	onMount(() => {
		// Verificación inmediata al montar el componente
		if (document.documentElement.classList.contains('dark')) {
			activeLogo = LOGO_DARK;
		}
	});
</script>

{#if show}
	<div class="w-full h-screen max-h-[100dvh] text-white relative">
		<div class="fixed m-10 z-50">
			<div class="flex space-x-2">
				<div class=" self-center">
					<img
						id="logo"
						crossorigin="anonymous"
						src={activeLogo}
						style="width: 300px !important; height: auto !important; max-width: none !important;"
						class="rounded-full object-contain"
						alt="GoDoWorks logo"
					/>
				</div>
			</div>
		</div>

		<SlideShow duration={5000} />

		<div
			class="w-full h-full absolute top-0 left-0 bg-linear-to-t from-20% from-black to-transparent"
		></div>

		<div class="w-full h-full absolute top-0 left-0 backdrop-blur-xs bg-black/50"></div>

		<div class="relative bg-transparent w-full h-screen max-h-[100dvh] flex z-10">
			<div class="flex flex-col justify-end w-full items-center pb-10 text-center">
				<div class="text-5xl lg:text-7xl font-secondary">
					<Marquee
						duration={5000}
						words={[
							$i18n.t('Explore the cosmos'),
							$i18n.t('Unlock mysteries'),
							$i18n.t('Chart new frontiers'),
							$i18n.t('Dive into knowledge'),
							$i18n.t('Discover wonders'),
							$i18n.t('Ignite curiosity'),
							$i18n.t('Forge new paths'),
							$i18n.t('Unravel secrets'),
							$i18n.t('Pioneer insights'),
							$i18n.t('Embark on adventures')
						]}
					/>

					<div class="mt-0.5">{$i18n.t(`wherever you are`)}</div>
				</div>

				<div class="flex justify-center mt-8">
					<div class="flex flex-col justify-center items-center">
						<button
							aria-labelledby="get-started"
							class="relative z-20 flex p-1 rounded-full bg-white/5 hover:bg-white/10 transition font-medium text-sm"
							on:click={() => {
								getStartedHandler();
							}}
						>
							<ArrowRightCircle className="size-6" />
						</button>
						<div id="get-started" class="mt-1.5 font-primary text-base font-medium">
							{$i18n.t(`Get started`)}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}