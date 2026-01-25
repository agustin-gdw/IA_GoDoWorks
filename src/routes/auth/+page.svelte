<script lang="ts">
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';

	import { toast } from 'svelte-sonner';

	import { onMount, getContext, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	import { getBackendConfig } from '$lib/apis';
	import {
		ldapUserSignIn,
		getSessionUser,
		userSignIn,
		userSignUp,
		updateUserTimezone
	} from '$lib/apis/auths';

	import { WEBUI_API_BASE_URL, WEBUI_BASE_URL } from '$lib/constants';
	import { WEBUI_NAME, config, user, socket } from '$lib/stores';

	import { generateInitialsImage, canvasPixelTest, getUserTimezone } from '$lib/utils';

	import Spinner from '$lib/components/common/Spinner.svelte';
	import OnBoarding from '$lib/components/OnBoarding.svelte';
	import SensitiveInput from '$lib/components/common/SensitiveInput.svelte';
	import { redirect } from '@sveltejs/kit';

	const i18n = getContext('i18n');

	let loaded = false;
	let showPassword = false;

	let mode = $config?.features.enable_ldap ? 'ldap' : 'signin';

	let form = null;

	let name = '';
	let email = '';
	let password = '';
	let confirmPassword = '';

	let ldapUsername = '';

	const setSessionUser = async (sessionUser, redirectPath: string | null = null) => {
		if (sessionUser) {
			console.log(sessionUser);
			toast.success($i18n.t(`You're now logged in.`));
			if (sessionUser.token) {
				localStorage.token = sessionUser.token;
			}
			$socket.emit('user-join', { auth: { token: sessionUser.token } });
			await user.set(sessionUser);
			await config.set(await getBackendConfig());

			// Update user timezone
			const timezone = getUserTimezone();
			if (sessionUser.token && timezone) {
				updateUserTimezone(sessionUser.token, timezone);
			}

			if (!redirectPath) {
				redirectPath = $page.url.searchParams.get('redirect') || '/';
			}

			goto(redirectPath);
			localStorage.removeItem('redirectPath');
		}
	};

	const signInHandler = async () => {
		const sessionUser = await userSignIn(email, password).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		await setSessionUser(sessionUser);
	};

	const signUpHandler = async () => {
		// Solo validamos si está habilitada la confirmación de contraseña
		if ($config?.features?.enable_signup_password_confirmation) {
			if (password !== confirmPassword) {
				toast.error($i18n.t('Passwords do not match.'));
				return;
			}
		}

		const sessionUser = await userSignUp(name, email, password, generateInitialsImage(name)).catch(
			(error) => {
				toast.error(`${error}`);
				return null;
			}
		);

		await setSessionUser(sessionUser);
	};

	const ldapSignInHandler = async () => {
		const sessionUser = await ldapUserSignIn(ldapUsername, password).catch((error) => {
			toast.error(`${error}`);
			return null;
		});
		await setSessionUser(sessionUser);
	};

	const submitHandler = async () => {
		if (mode === 'ldap') {
			await ldapSignInHandler();
		} else if (mode === 'signin') {
			await signInHandler();
		} else {
			await signUpHandler();
		}
	};

	const oauthCallbackHandler = async () => {
		// Get the value of the 'token' cookie
		function getCookie(name) {
			const match = document.cookie.match(
				new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
			);
			return match ? decodeURIComponent(match[1]) : null;
		}

		const token = getCookie('token');
		if (!token) {
			return;
		}

		const sessionUser = await getSessionUser(token).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (!sessionUser) {
			return;
		}

		localStorage.token = token;
		await setSessionUser(sessionUser, localStorage.getItem('redirectPath') || null);
	};

	let onboarding = false;

	async function setLogoImage() {
		await tick();
		const logo = document.getElementById('logo');

		if (logo) {
			const isDarkMode = document.documentElement.classList.contains('dark');

			if (isDarkMode) {
				const darkImage = new Image();
				darkImage.src = `${WEBUI_BASE_URL}/static/favicon-dark.png`;

				darkImage.onload = () => {
					logo.src = `${WEBUI_BASE_URL}/static/favicon-dark.png`;
					logo.style.filter = ''; // Ensure no inversion is applied if favicon-dark.png exists
				};

				darkImage.onerror = () => {
					logo.style.filter = 'invert(1)'; // Invert image if favicon-dark.png is missing
				};
			}
		}
	}

	onMount(async () => {
		const redirectPath = $page.url.searchParams.get('redirect');
		if ($user !== undefined) {
			goto(redirectPath || '/');
		} else {
			if (redirectPath) {
				localStorage.setItem('redirectPath', redirectPath);
			}
		}

		const error = $page.url.searchParams.get('error');
		if (error) {
			toast.error(error);
		}

		await oauthCallbackHandler();
		form = $page.url.searchParams.get('form');

		loaded = true;
		setLogoImage();

		if (($config?.features.auth_trusted_header ?? false) || $config?.features.auth === false) {
			await signInHandler();
		} else {
			onboarding = $config?.onboarding ?? false;
		}
	});
</script>

<svelte:head>
	<title>{$WEBUI_NAME}</title>
</svelte:head>

<OnBoarding
	bind:show={onboarding}
	getStartedHandler={() => {
		onboarding = false;
		mode = $config?.features.enable_ldap ? 'ldap' : 'signup';
	}}
/>

<div class="w-full h-screen max-h-[100dvh] text-white relative" id="auth-page">
	<!-- Fondo oscuro sólido SIEMPRE debajo de todo -->
	<div class="w-full h-full absolute top-0 left-0 bg-black"></div>

	<!-- Imagen de fondo de GoDoWorks -->
	<div class="background-image-layer"></div>

	<div class="w-full absolute top-0 left-0 right-0 h-8 drag-region" />

	{#if loaded}
		<div
			class="fixed bg-transparent min-h-screen w-full flex justify-center font-primary z-50 text-black dark:text-white"
			id="auth-container"
		>
			<!-- Contenido principal con z-index superior -->
			<div class="w-full min-h-screen flex flex-col relative" style="z-index: 100;">
				{#if ($config?.features.auth_trusted_header ?? false) || $config?.features.auth === false}
					<div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full sm:max-w-md">
						<div class="flex items-center justify-center gap-3 text-xl sm:text-2xl text-center font-medium text-white">
							<div>
								{$i18n.t('Signing in to {{WEBUI_NAME}}', { WEBUI_NAME: $WEBUI_NAME })}
							</div>
							<div>
								<Spinner className="size-5" />
							</div>
						</div>
					</div>
				{:else}
					<!-- MODO INICIAR SESIÓN -->
					{#if mode === 'signin'}
						<!-- Campo EMAIL - Coords: 386,416,779,453 -->
						<!-- Width: 779 - 386 = 393px -->
						<!-- Height: 453 - 416 = 37px -->
						<div class="input-field" style="left: 386px; top: 416px; width: 393px; height: 37px;">
							<input
								bind:value={email}
								type="email"
								autocomplete="email"
								placeholder=""
								class="visible-input"
								required
							/>
						</div>

						<!-- Campo CLAVE - Coords: 386,471,736,508 -->
						<!-- Width: 736 - 386 = 350px -->
						<!-- Height: 508 - 471 = 37px -->
						<div class="input-field" style="left: 386px; top: 471px; width: 350px; height: 37px;">
							<input
								bind:value={password}
								type={showPassword ? 'text' : 'password'}
								autocomplete="current-password"
								placeholder=""
								class="visible-input"
								required
							/>
						</div>

						<!-- Botón MOSTRAR CLAVE - Coords: 742,471,779,508 -->
						<!-- Width: 779 - 742 = 37px -->
						<!-- Height: 508 - 471 = 37px -->
						<button
							class="transparent-button"
							style="left: 742px; top: 471px; width: 37px; height: 37px;"
							on:click={() => (showPassword = !showPassword)}
							type="button"
							aria-label={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
						></button>

						<!-- Botón INICIAR SESIÓN - Coords: 343,532,779,569 -->
						<!-- Width: 779 - 343 = 436px -->
						<!-- Height: 569 - 532 = 37px -->
						<button
							class="transparent-button"
							style="left: 343px; top: 532px; width: 436px; height: 37px;"
							on:click={submitHandler}
							type="button"
							aria-label="Iniciar sesión"
						></button>

						<!-- Botón CREAR CUENTA - Coords: 383,589,780,620 -->
						<!-- Width: 780 - 383 = 397px -->
						<!-- Height: 620 - 589 = 31px -->
						<button
							class="transparent-button"
							style="left: 383px; top: 589px; width: 397px; height: 31px;"
							on:click={() => (mode = 'signup')}
							type="button"
							aria-label="Crear cuenta"
						></button>
					{:else if mode === 'signup'}
						<!-- MODO CREAR CUENTA: Solo nombre, email y clave -->
						<!-- Campo NOMBRE - posición del email -->
						<div class="input-field" style="left: 386px; top: 416px; width: 393px; height: 37px;">
							<input
								bind:value={name}
								type="text"
								autocomplete="name"
								placeholder=""
								class="visible-input"
								required
							/>
						</div>

						<!-- Campo EMAIL - posición de la clave -->
						<div class="input-field" style="left: 386px; top: 471px; width: 350px; height: 37px;">
							<input
								bind:value={email}
								type="email"
								autocomplete="email"
								placeholder=""
								class="visible-input"
								required
							/>
						</div>

						<!-- Campo CLAVE - nueva posición debajo -->
						<div class="input-field" style="left: 386px; top: 526px; width: 350px; height: 37px;">
							<input
								bind:value={password}
								type={showPassword ? 'text' : 'password'}
								autocomplete="new-password"
								placeholder=""
								class="visible-input"
								required
							/>
						</div>

						<!-- Botón MOSTRAR CLAVE - ajustado al lado de la clave -->
						<button
							class="transparent-button"
							style="left: 742px; top: 526px; width: 37px; height: 37px;"
							on:click={() => (showPassword = !showPassword)}
							type="button"
							aria-label={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
						></button>

						<!-- Botón CREAR CUENTA -->
						<button
							class="transparent-button"
							style="left: 343px; top: 532px; width: 436px; height: 37px;"
							on:click={submitHandler}
							type="button"
							aria-label="Crear cuenta"
						></button>

						<!-- Botón INICIAR SESIÓN -->
						<button
							class="transparent-button"
							style="left: 383px; top: 589px; width: 397px; height: 31px;"
							on:click={() => (mode = 'signin')}
							type="button"
							aria-label="Iniciar sesión"
						></button>

						<!-- Campo oculto para confirmar contraseña (si el sistema lo necesita) -->
						{#if $config?.features?.enable_signup_password_confirmation}
							<input
								bind:value={confirmPassword}
								type="hidden"
							/>
						{/if}
					{:else if mode === 'ldap'}
						<!-- MODO LDAP -->
						<!-- Campo USUARIO LDAP - posición del email -->
						<div class="input-field" style="left: 386px; top: 416px; width: 393px; height: 37px;">
							<input
								bind:value={ldapUsername}
								type="text"
								autocomplete="username"
								placeholder=""
								class="visible-input"
								required
							/>
						</div>

						<!-- Campo CLAVE - posición de la clave -->
						<div class="input-field" style="left: 386px; top: 471px; width: 350px; height: 37px;">
							<input
								bind:value={password}
								type={showPassword ? 'text' : 'password'}
								autocomplete="current-password"
								placeholder=""
								class="visible-input"
								required
							/>
						</div>

						<!-- Botón MOSTRAR CLAVE -->
						<button
							class="transparent-button"
							style="left: 742px; top: 471px; width: 37px; height: 37px;"
							on:click={() => (showPassword = !showPassword)}
							type="button"
							aria-label={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
						></button>

						<!-- Botón AUTHENTICATE - Coords: 343,532,779,569 -->
						<button
							class="transparent-button"
							style="left: 343px; top: 532px; width: 436px; height: 37px;"
							on:click={submitHandler}
							type="button"
							aria-label="Autenticar"
						></button>

						<!-- Botón para volver a email -->
						<button
							class="transparent-button"
							style="left: 383px; top: 589px; width: 397px; height: 31px;"
							on:click={() => (mode = 'signin')}
							type="button"
							aria-label="Continuar con email"
						></button>
					{/if}

					<!-- OAuth Buttons - visibles si están configurados -->
					{#if Object.keys($config?.oauth?.providers ?? {}).length > 0}
						<div class="oauth-container">
							{#if $config?.oauth?.providers?.google}
								<button
									class="oauth-button"
									on:click={() => {
										window.location.href = `${WEBUI_BASE_URL}/oauth/google/login`;
									}}
								>
									{$i18n.t('Continue with {{provider}}', { provider: 'Google' })}
								</button>
							{/if}
							{#if $config?.oauth?.providers?.microsoft}
								<button
									class="oauth-button"
									on:click={() => {
										window.location.href = `${WEBUI_BASE_URL}/oauth/microsoft/login`;
									}}
								>
									{$i18n.t('Continue with {{provider}}', { provider: 'Microsoft' })}
								</button>
							{/if}
							{#if $config?.oauth?.providers?.github}
								<button
									class="oauth-button"
									on:click={() => {
										window.location.href = `${WEBUI_BASE_URL}/oauth/github/login`;
									}}
								>
									{$i18n.t('Continue with {{provider}}', { provider: 'GitHub' })}
								</button>
							{/if}
							{#if $config?.oauth?.providers?.oidc}
								<button
									class="oauth-button"
									on:click={() => {
										window.location.href = `${WEBUI_BASE_URL}/oauth/oidc/login`;
									}}
								>
									{$i18n.t('Continue with {{provider}}', {
										provider: $config?.oauth?.providers?.oidc ?? 'SSO'
									})}
								</button>
							{/if}
							{#if $config?.oauth?.providers?.feishu}
								<button
									class="oauth-button"
									on:click={() => {
										window.location.href = `${WEBUI_BASE_URL}/oauth/feishu/login`;
									}}
								>
									{$i18n.t('Continue with {{provider}}', { provider: 'Feishu' })}
								</button>
							{/if}
						</div>
					{/if}

					<!-- LDAP Toggle -->
					{#if $config?.features.enable_ldap && $config?.features.enable_login_form}
						<button
							class="ldap-toggle"
							on:click={() => {
								if (mode === 'ldap') {
									mode = ($config?.onboarding ?? false) ? 'signup' : 'signin';
								} else {
									mode = 'ldap';
								}
							}}
							type="button"
						>
							{#if mode === 'ldap'}
								{$i18n.t('Continue with Email')}
							{:else}
								{$i18n.t('Continue with LDAP')}
							{/if}
						</button>
					{/if}
				{/if}

				<!-- Logo flotante -->
				{#if !$config?.metadata?.auth_logo_position}
					<div class="fixed m-10" style="z-index: 200;">
						<div class="flex space-x-2">
							<div class="self-center">
								<img
									id="logo"
									crossorigin="anonymous"
									src="{WEBUI_BASE_URL}/static/favicon.png"
									class="w-6 rounded-full"
									alt=""
								/>
							</div>
						</div>
					</div>
				{/if}

				<!-- Footer -->
				{#if $config?.metadata?.login_footer}
					<div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 max-w-3xl" style="z-index: 200;">
						<div class="text-[0.7rem] text-gray-400 marked">
							{@html DOMPurify.sanitize(marked($config?.metadata?.login_footer))}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Fondo con imagen de GoDoWorks - SIEMPRE debajo de todo */
	.background-image-layer {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-image: url('https://github.com/agustin-gdw/IA_GoDoWorks/raw/b5e9bd685877d5d6e7bf2dabe41c008e4baa9bb3/static/gdw.png');
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		z-index: 1;
	}

	/* Contenedor principal con z-index alto para que todo esté encima */
	#auth-container {
		position: relative;
		z-index: 50;
	}

	/* Campos de input con texto visible y posicionamiento absoluto */
	.input-field {
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.visible-input {
		width: 100%;
		height: 100%;
		background: transparent;
		border: none;
		outline: none;
		padding-left: 15px;
		padding-right: 15px;
		color: #1a1a1a;
		font-size: 14px;
		caret-color: #1a7a9e;
	}

	.visible-input::placeholder {
		color: #666;
	}

	.visible-input:focus {
		outline: none;
	}

	/* Botones transparentes para las áreas clicables */
	.transparent-button {
		position: absolute;
		z-index: 150;
		background: transparent;
		border: none;
		outline: none;
		cursor: pointer;
		padding: 0;
		margin: 0;
	}

	.transparent-button:hover {
		opacity: 0.8;
	}

	.transparent-button:focus {
		outline: none;
	}

	.transparent-button:active {
		opacity: 0.6;
	}

	/* Contenedor para botones OAuth */
	.oauth-container {
		position: absolute;
		bottom: 80px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 10px;
		z-index: 200;
	}

	.oauth-button {
		background: rgba(255, 255, 255, 0.95);
		color: #1a1a1a;
		padding: 10px 20px;
		border: 1px solid #ccc;
		border-radius: 5px;
		cursor: pointer;
		font-size: 12px;
		white-space: nowrap;
		min-width: 200px;
		transition: background 0.2s;
	}

	.oauth-button:hover {
		background: rgba(255, 255, 255, 1);
	}

	/* Toggle LDAP */
	.ldap-toggle {
		position: absolute;
		bottom: 40px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(255, 255, 255, 0.95);
		color: #1a1a1a;
		padding: 8px 16px;
		border: 1px solid #ccc;
		border-radius: 5px;
		cursor: pointer;
		font-size: 12px;
		white-space: nowrap;
		z-index: 200;
		transition: background 0.2s;
	}

	.ldap-toggle:hover {
		background: rgba(255, 255, 255, 1);
	}

	.ldap-toggle:focus {
		outline: none;
	}
</style>
