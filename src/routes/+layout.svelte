<script>
	import { io } from 'socket.io-client';
	import { spring } from 'svelte/motion';
	import PyodideWorker from '$lib/workers/pyodide.worker?worker';
	import { Toaster, toast } from 'svelte-sonner';

	let loadingProgress = spring(0, { stiffness: 0.05 });

	import { onMount, tick, setContext, onDestroy } from 'svelte';
	import {
		config,
		user,
		settings,
		theme,
		WEBUI_NAME,
		WEBUI_VERSION,
		WEBUI_DEPLOYMENT_ID,
		mobile,
		socket,
		chatId,
		chats,
		currentChatPage,
		tags,
		temporaryChatEnabled,
		isLastActiveTab,
		isApp,
		appInfo,
		toolServers,
		playingNotificationSound,
		channels,
		channelId
	} from '$lib/stores';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { beforeNavigate } from '$app/navigation';
	import { updated } from '$app/state';

	import i18n, { initI18n, getLanguages, changeLanguage } from '$lib/i18n';

	import '../tailwind.css';
	import '../app.css';
	import 'tippy.js/dist/tippy.css';

	import { executeToolServer, getBackendConfig, getVersion } from '$lib/apis';
	import { getSessionUser, userSignOut } from '$lib/apis/auths';
	import { getAllTags, getChatList } from '$lib/apis/chats';
	import { chatCompletion } from '$lib/apis/openai';

	import { WEBUI_API_BASE_URL, WEBUI_BASE_URL, WEBUI_HOSTNAME } from '$lib/constants';
	import { bestMatchingLanguage } from '$lib/utils';
	import { setTextScale } from '$lib/utils/text-scale';

	import NotificationToast from '$lib/components/NotificationToast.svelte';
	import AppSidebar from '$lib/components/app/AppSidebar.svelte';
	import SyncStatsModal from '$lib/components/chat/Settings/SyncStatsModal.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { getUserSettings } from '$lib/apis/users';
	import dayjs from 'dayjs';
	import { getChannels } from '$lib/apis/channels';

	const BREAKPOINT = 768;
	const TOKEN_EXPIRY_BUFFER = 60; // seconds
	const HEARTBEAT_INTERVAL = 30000; // 30 seconds
	const TOKEN_CHECK_INTERVAL = 15000; // 15 seconds
	const WELCOME_AUDIO_DELAY = 2000; // 2 seconds

	// State variables
	let loaded = false;
	let tokenTimer = null;
	let heartbeatInterval = null;
	let showRefresh = false;
	let showSyncStatsModal = false;
	let syncStatsEventData = null;
	let welcomeAudio = null;
	let welcomeAudioPlayed = false;

	const bc = new BroadcastChannel('active-tab-channel');

	setContext('i18n', i18n);

	// ==================== SERVICE WORKERS ====================
	const unregisterServiceWorkers = async () => {
		if ('serviceWorker' in navigator) {
			try {
				const registrations = await navigator.serviceWorker.getRegistrations();
				await Promise.all(registrations.map((r) => r.unregister()));
				return true;
			} catch (error) {
				console.error('Error unregistering service workers:', error);
				return false;
			}
		}
		return false;
	};

	// ==================== FRONTEND UPDATES ====================
	beforeNavigate(async ({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) {
			await unregisterServiceWorkers();
			location.href = to.url.href;
		}
	});

	// ==================== AUTH ROUTE STYLING ====================
	$: if (typeof document !== 'undefined') {
		document.body.classList.toggle('auth-split', $page.url.pathname.startsWith('/auth'));
	}

	// ==================== WELCOME AUDIO ====================
	const playWelcomeAudio = async () => {
		if (!$user || !loaded || !welcomeAudio || welcomeAudioPlayed) return;

		const token = localStorage.getItem('token');
		if (!token) return;

		const tokenSignature = token.slice(-15);
		const welcomeKey = `welcome_sound_played_${tokenSignature}`;
		
		if (localStorage.getItem(welcomeKey)) return;

		welcomeAudioPlayed = true;

		setTimeout(async () => {
			try {
				welcomeAudio.currentTime = 0;
				const playPromise = welcomeAudio.play();

				if (playPromise !== undefined) {
					playPromise
						.then(() => {
							console.log('Welcome audio played successfully');
							localStorage.setItem(welcomeKey, 'true');
						})
						.catch((error) => {
							console.log('Autoplay blocked, waiting for user interaction...');
							
							const playOnInteraction = () => {
								welcomeAudio.play();
								localStorage.setItem(welcomeKey, 'true');
								['click', 'touchstart', 'keydown'].forEach(event => 
									document.removeEventListener(event, playOnInteraction)
								);
							};

							['click', 'touchstart', 'keydown'].forEach(event =>
								document.addEventListener(event, playOnInteraction, { once: true })
							);
						});
				}
			} catch (error) {
				console.error('Error playing welcome audio:', error);
			}
		}, WELCOME_AUDIO_DELAY);
	};

	$: playWelcomeAudio();

	// ==================== SOCKET SETUP ====================
	const setupSocket = async (enableWebsocket) => {
		const _socket = io(`${WEBUI_BASE_URL}` || undefined, {
			reconnection: true,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 5000,
			randomizationFactor: 0.5,
			path: '/ws/socket.io',
			transports: enableWebsocket ? ['websocket'] : ['polling', 'websocket'],
			auth: { token: localStorage.token }
		});

		await socket.set(_socket);

		_socket.on('connect_error', (err) => console.log('connect_error', err));

		_socket.on('connect', async () => {
			console.log('Socket connected:', _socket.id);
			
			const res = await getVersion(localStorage.token);
			const { deployment_id: deploymentId = null, version = null } = res || {};

			// Check for version updates
			if (version !== null || deploymentId !== null) {
				if (
					($WEBUI_VERSION !== null && version !== $WEBUI_VERSION) ||
					($WEBUI_DEPLOYMENT_ID !== null && deploymentId !== $WEBUI_DEPLOYMENT_ID)
				) {
					await unregisterServiceWorkers();
					location.href = location.href;
					return;
				}
			}

			// Setup heartbeat
			heartbeatInterval = setInterval(() => {
				if (_socket.connected) {
					console.log('Sending heartbeat');
					_socket.emit('heartbeat', {});
				}
			}, HEARTBEAT_INTERVAL);

			if (deploymentId !== null) WEBUI_DEPLOYMENT_ID.set(deploymentId);
			if (version !== null) WEBUI_VERSION.set(version);

			console.log('Version:', version);

			// Emit user-join event
			if (localStorage.getItem('token')) {
				_socket.emit('user-join', { auth: { token: localStorage.token } });
			} else {
				console.warn('No token found, user-join event not emitted');
			}
		});

		_socket.on('reconnect_attempt', (attempt) => console.log('reconnect_attempt', attempt));
		_socket.on('reconnect_failed', () => console.log('reconnect_failed'));

		_socket.on('disconnect', (reason, details) => {
			console.log(`Socket ${_socket.id} disconnected due to ${reason}`);

			if (heartbeatInterval) {
				clearInterval(heartbeatInterval);
				heartbeatInterval = null;
			}

			if (details) console.log('Additional details:', details);
		});
	};

	// ==================== PYTHON EXECUTION ====================
	const executePythonAsWorker = async (id, code, cb) => {
		let result = null;
		let stdout = null;
		let stderr = null;
		let executing = true;

		const detectPackages = (code) => {
			const patterns = {
				requests: /\bimport\s+requests\b|\bfrom\s+requests\b/,
				beautifulsoup4: /\bimport\s+bs4\b|\bfrom\s+bs4\b/,
				numpy: /\bimport\s+numpy\b|\bfrom\s+numpy\b/,
				pandas: /\bimport\s+pandas\b|\bfrom\s+pandas\b/,
				matplotlib: /\bimport\s+matplotlib\b|\bfrom\s+matplotlib\b/,
				seaborn: /\bimport\s+seaborn\b|\bfrom\s+seaborn\b/,
				'scikit-learn': /\bimport\s+sklearn\b|\bfrom\s+sklearn\b/,
				scipy: /\bimport\s+scipy\b|\bfrom\s+scipy\b/,
				regex: /\bimport\s+re\b|\bfrom\s+re\b/,
				sympy: /\bimport\s+sympy\b|\bfrom\s+sympy\b/,
				tiktoken: /\bimport\s+tiktoken\b|\bfrom\s+tiktoken\b/,
				pytz: /\bimport\s+pytz\b|\bfrom\s+pytz\b/
			};

			return Object.entries(patterns)
				.filter(([_, pattern]) => pattern.test(code))
				.map(([pkg]) => pkg);
		};

		const packages = detectPackages(code);
		const pyodideWorker = new PyodideWorker();

		pyodideWorker.postMessage({ id, code, packages });

		// Timeout after 60 seconds
		const timeout = setTimeout(() => {
			if (executing) {
				executing = false;
				stderr = 'Execution Time Limit Exceeded';
				pyodideWorker.terminate();

				if (cb) {
					cb(JSON.parse(JSON.stringify({ stdout, stderr, result }, 
						(_, value) => typeof value === 'bigint' ? value.toString() : value
					)));
				}
			}
		}, 60000);

		pyodideWorker.onmessage = (event) => {
			console.log('pyodideWorker.onmessage', event);
			clearTimeout(timeout);
			
			const { id, ...data } = event.data;
			
			if (data.stdout) stdout = data.stdout;
			if (data.stderr) stderr = data.stderr;
			if (data.result) result = data.result;

			if (cb) {
				cb(JSON.parse(JSON.stringify({ stdout, stderr, result },
					(_, value) => typeof value === 'bigint' ? value.toString() : value
				)));
			}

			executing = false;
		};

		pyodideWorker.onerror = (event) => {
			console.error('pyodideWorker.onerror', event);
			clearTimeout(timeout);

			if (cb) {
				cb(JSON.parse(JSON.stringify({ stdout, stderr, result },
					(_, value) => typeof value === 'bigint' ? value.toString() : value
				)));
			}
			
			executing = false;
		};
	};

	// ==================== TOOL EXECUTION ====================
	const executeTool = async (data, cb) => {
		const toolServer = $settings?.toolServers?.find((server) => server.url === data.server?.url);
		const toolServerData = $toolServers?.find((server) => server.url === data.server?.url);

		console.log('executeTool', data, toolServer);

		if (!toolServer) {
			if (cb) {
				cb(JSON.parse(JSON.stringify({ error: 'Tool Server Not Found' })));
			}
			return;
		}

		let toolServerToken = null;
		const authType = toolServer?.auth_type ?? 'bearer';

		switch (authType) {
			case 'bearer':
				toolServerToken = toolServer?.key;
				break;
			case 'session':
				toolServerToken = localStorage.token;
				break;
			case 'none':
			default:
				break;
		}

		const res = await executeToolServer(
			toolServerToken,
			toolServer.url,
			data?.name,
			data?.params,
			toolServerData
		);

		console.log('executeToolServer', res);
		if (cb) {
			cb(JSON.parse(JSON.stringify(res)));
		}
	};

	// ==================== CHAT EVENT HANDLER ====================
	const chatEventHandler = async (event, cb) => {
		const isCurrentChat = $page.url.pathname.includes(`/c/${event.chat_id}`);
		
		let isFocused = document.visibilityState === 'visible';
		if (window.electronAPI) {
			const res = await window.electronAPI.send({ type: 'window:isFocused' });
			if (res) isFocused = res.isFocused;
		}

		await tick();
		
		const type = event?.data?.type ?? null;
		const data = event?.data?.data ?? null;

		// Handle events for non-current chats or unfocused windows
		if ((event.chat_id !== $chatId && !$temporaryChatEnabled) || !isFocused) {
			if (type === 'chat:completion') {
				const { done, content, title } = data;

				if (done) {
					// Play notification sound
					if ($settings?.notificationSoundAlways ?? false) {
						playingNotificationSound.set(true);
						const audio = new Audio(`/audio/notification.mp3`);
						audio.play().finally(() => playingNotificationSound.set(false));
					}

					// Show browser notification
					if ($isLastActiveTab && ($settings?.notificationEnabled ?? false)) {
						new Notification(`${title} • GoDoWorks Intelligent Systems`, {
							body: content,
							icon: `https://raw.githubusercontent.com/agustin-gdw/IA_GoDoWorks/cee37eb2835262194239dd473d2f34d9ffa783fa/Favicon1%20(2).png`
						});
					}

					// Show toast notification
					toast.custom(NotificationToast, {
						componentProps: {
							onClick: () => goto(`/c/${event.chat_id}`),
							content,
							title
						},
						duration: 15000,
						unstyled: true
					});
				}
			} else if (type === 'chat:title') {
				currentChatPage.set(1);
				await chats.set(await getChatList(localStorage.token, $currentChatPage));
			} else if (type === 'chat:tags') {
				tags.set(await getAllTags(localStorage.token));
			}
		} 
		// Handle events for current session
		else if (data?.session_id === $socket.id) {
			switch (type) {
				case 'execute:python':
					console.log('execute:python', data);
					executePythonAsWorker(data.id, data.code, cb);
					break;

				case 'execute:tool':
					console.log('execute:tool', data);
					executeTool(data, cb);
					break;

				case 'request:chat:completion':
					console.log('request:chat:completion', data, $socket.id);
					await handleChatCompletion(data, cb);
					break;

				default:
					console.log('chatEventHandler', event);
			}
		}
	};

	// ==================== CHAT COMPLETION HANDLER ====================
	const handleChatCompletion = async (data, cb) => {
		const { session_id, channel, form_data, model } = data;

		try {
			const directConnections = $settings?.directConnections ?? {};
			if (!directConnections) return;

			const urlIdx = model?.urlIdx;
			const OPENAI_API_URL = directConnections.OPENAI_API_BASE_URLS[urlIdx];
			const OPENAI_API_KEY = directConnections.OPENAI_API_KEYS[urlIdx];
			const API_CONFIG = directConnections.OPENAI_API_CONFIGS[urlIdx];

			// Remove prefix if configured
			if (API_CONFIG?.prefix_id) {
				const prefixId = API_CONFIG.prefix_id;
				form_data.model = form_data.model.replace(`${prefixId}.`, '');
			}

			const [res, controller] = await chatCompletion(
				OPENAI_API_KEY,
				form_data,
				OPENAI_API_URL
			);

			if (!res) {
				throw new Error('An error occurred while fetching the completion');
			}

			if (!res.ok) {
				throw await res.json();
			}

			if (form_data?.stream ?? false) {
				cb({ status: true });
				console.log({ status: true });

				const reader = res.body.getReader();
				const decoder = new TextDecoder();

				const processStream = async () => {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						const chunk = decoder.decode(value, { stream: true });
						const lines = chunk.split('\n').filter((line) => line.trim() !== '');

						for (const line of lines) {
							console.log(line);
							$socket?.emit(channel, line);
						}
					}
				};

				await processStream();
			} else {
				const responseData = await res.json();
				cb(responseData);
			}
		} catch (error) {
			console.error('chatCompletion error:', error);
			cb(error);
		} finally {
			$socket.emit(channel, { done: true });
		}
	};

	// ==================== CHANNEL EVENT HANDLER ====================
	const channelEventHandler = async (event) => {
		console.log('channelEventHandler', event);
		
		if (event.data?.type === 'typing') return;

		// Handle channel created event
		if (event.data?.type === 'channel:created') {
			const res = await getChannels(localStorage.token).catch(() => null);
			if (res) {
				await channels.set(
					res.sort((a, b) =>
						['', null, 'group', 'dm'].indexOf(a.type) - ['', null, 'group', 'dm'].indexOf(b.type)
					)
				);
			}
			return;
		}

		const isCurrentChannel = $page.url.pathname.includes(`/channels/${event.channel_id}`);
		
		let isFocused = document.visibilityState === 'visible';
		if (window.electronAPI) {
			const res = await window.electronAPI.send({ type: 'window:isFocused' });
			if (res) isFocused = res.isFocused;
		}

		if ((!isCurrentChannel || !isFocused) && event?.user?.id !== $user?.id) {
			await tick();
			
			const type = event?.data?.type ?? null;
			const data = event?.data?.data ?? null;

			// Update channel list
			if ($channels) {
				const existingChannel = $channels.find((ch) => ch.id === event.channel_id);
				
				if (existingChannel && $channelId !== event.channel_id) {
					channels.set(
						$channels.map((ch) => {
							if (ch.id === event.channel_id && type === 'message') {
								return {
									...ch,
									unread_count: (ch.unread_count ?? 0) + 1,
									last_message_at: event.created_at
								};
							}
							return ch;
						})
					);
				} else {
					const res = await getChannels(localStorage.token).catch(() => null);
					if (res) {
						await channels.set(
							res.sort((a, b) =>
								['', null, 'group', 'dm'].indexOf(a.type) - ['', null, 'group', 'dm'].indexOf(b.type)
							)
						);
					}
				}
			}

			// Show notifications for messages
			if (type === 'message') {
				const title = `${data?.user?.name}${event?.channel?.type !== 'dm' ? ` (#${event?.channel?.name})` : ''}`;

				if ($isLastActiveTab && ($settings?.notificationEnabled ?? false)) {
					new Notification(`${title} • GoDoWorks Intelligent Systems`, {
						body: data?.content,
						icon: `${WEBUI_API_BASE_URL}/users/${data?.user?.id}/profile/image`
					});
				}

				toast.custom(NotificationToast, {
					componentProps: {
						onClick: () => goto(`/channels/${event.channel_id}`),
						content: data?.content,
						title
					},
					duration: 15000,
					unstyled: true
				});
			}
		}
	};

	// ==================== TOKEN EXPIRY CHECK ====================
	const checkTokenExpiry = async () => {
		const exp = $user?.expires_at;
		const now = Math.floor(Date.now() / 1000);

		if (!exp) return;

		if (now >= exp - TOKEN_EXPIRY_BUFFER) {
			const res = await userSignOut();
			user.set(null);
			localStorage.removeItem('token');
			location.href = res?.redirect_url ?? '/auth';
		}
	};

	// ==================== WINDOW MESSAGE HANDLER ====================
	const windowMessageEventHandler = async (event) => {
		const allowedOrigins = [
			'https://openwebui.com',
			'https://www.openwebui.com',
			'http://localhost:9999'
		];

		if (!allowedOrigins.includes(event.origin)) return;

		if (event.data === 'export:stats' || event.data?.type === 'export:stats') {
			syncStatsEventData = event.data;
			showSyncStatsModal = true;
		}
	};

	// ==================== ON MOUNT ====================
	onMount(async () => {
		// Preload welcome audio
		welcomeAudio = new Audio(`/welcome.mp3?t=${Date.now()}`);
		welcomeAudio.preload = 'auto';
		welcomeAudio.volume = 0.5;
		welcomeAudio.load();

		window.addEventListener('message', windowMessageEventHandler);

		// Pull-to-refresh functionality
		let touchstartY = 0;

		const isNavOrDescendant = (el) => {
			const nav = document.querySelector('nav');
			return nav && (el === nav || nav.contains(el));
		};

		document.addEventListener('touchstart', (e) => {
			if (!isNavOrDescendant(e.target)) return;
			touchstartY = e.touches[0].clientY;
		});

		document.addEventListener('touchmove', (e) => {
			if (!isNavOrDescendant(e.target)) return;
			const touchY = e.touches[0].clientY;
			const touchDiff = touchY - touchstartY;
			if (touchDiff > 50 && window.scrollY === 0) {
				showRefresh = true;
				e.preventDefault();
			}
		});

		document.addEventListener('touchend', (e) => {
			if (!isNavOrDescendant(e.target)) return;
			if (showRefresh) {
				showRefresh = false;
				location.reload();
			}
		});

		// Apply theme
		if (typeof window !== 'undefined' && window.applyTheme) {
			window.applyTheme();
		}

		// Electron app detection
		if (window?.electronAPI) {
			const info = await window.electronAPI.send({ type: 'app:info' });
			if (info) {
				isApp.set(true);
				appInfo.set(info);

				const data = await window.electronAPI.send({ type: 'app:data' });
				if (data) appData.set(data);
			}
		}

		// Active tab management
		bc.onmessage = (event) => {
			if (event.data === 'active') {
				isLastActiveTab.set(false);
			}
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				isLastActiveTab.set(true);
				bc.postMessage('active');
				checkTokenExpiry();
			}
		};

		document.addEventListener('visibilitychange', handleVisibilityChange);
		handleVisibilityChange();

		// Theme and mobile setup
		theme.set(localStorage.theme);
		mobile.set(window.innerWidth < BREAKPOINT);

		const onResize = () => {
			mobile.set(window.innerWidth < BREAKPOINT);
		};
		window.addEventListener('resize', onResize);

		// User subscription
		user.subscribe(async (value) => {
			if (value) {
				$socket?.off('events', chatEventHandler);
				$socket?.off('events:channel', channelEventHandler);
				$socket?.on('events', chatEventHandler);
				$socket?.on('events:channel', channelEventHandler);

				const userSettings = await getUserSettings(localStorage.token);
				if (userSettings) {
					settings.set(userSettings.ui);
				} else {
					settings.set(JSON.parse(localStorage.getItem('settings') ?? '{}'));
				}
				
				setTextScale($settings?.textScale ?? 1);

				if (tokenTimer) clearInterval(tokenTimer);
				tokenTimer = setInterval(checkTokenExpiry, TOKEN_CHECK_INTERVAL);
			} else {
				$socket?.off('events', chatEventHandler);
				$socket?.off('events:channel', channelEventHandler);
			}
		});

		// Backend config initialization
		let backendConfig = null;
		try {
			backendConfig = await getBackendConfig();
			console.log('Backend config:', backendConfig);
		} catch (error) {
			console.error('Error loading backend config:', error);
		}

		// Initialize i18n
		initI18n(localStorage?.locale);
		if (!localStorage.locale) {
			const languages = await getLanguages();
			const browserLanguages = navigator.languages ?? [navigator.language || navigator.userLanguage];
			const lang = backendConfig?.default_locale ?? bestMatchingLanguage(languages, browserLanguages, 'en-US');
			changeLanguage(lang);
			dayjs.locale(lang);
		}

		if (backendConfig) {
			await config.set(backendConfig);
			await WEBUI_NAME.set(backendConfig.name);

			if ($config) {
				await setupSocket($config.features?.enable_websocket ?? true);

				const currentUrl = `${window.location.pathname}${window.location.search}`;
				const encodedUrl = encodeURIComponent(currentUrl);

				if (localStorage.token) {
					const sessionUser = await getSessionUser(localStorage.token).catch((error) => {
						toast.error(`${error}`);
						return null;
					});

					if (sessionUser) {
						await user.set(sessionUser);
						await config.set(await getBackendConfig());
					} else {
						localStorage.removeItem('token');
						await goto(`/auth?redirect=${encodedUrl}`);
					}
				} else {
					if ($page.url.pathname !== '/auth') {
						await goto(`/auth?redirect=${encodedUrl}`);
					}
				}
			}
		} else {
			await goto(`/error`);
		}

		await tick();

		// Handle splash screen
		if (
			document.documentElement.classList.contains('her') &&
			document.getElementById('progress-bar')
		) {
			loadingProgress.subscribe((value) => {
				const progressBar = document.getElementById('progress-bar');
				if (progressBar) progressBar.style.width = `${value}%`;
			});

			await loadingProgress.set(100);
			document.getElementById('splash-screen')?.remove();

			const audio = new Audio(`/audio/greeting.mp3`);
			const playAudio = () => {
				audio.play();
				document.removeEventListener('click', playAudio);
			};
			document.addEventListener('click', playAudio);

			loaded = true;
		} else {
			document.getElementById('splash-screen')?.remove();
			loaded = true;
		}

		// Auto-show SyncStatsModal
		if ((window.opener ?? false) && $page.url.searchParams.get('sync') === 'true') {
			showSyncStatsModal = true;
		}

		return () => {
			window.removeEventListener('resize', onResize);
		};
	});

	onDestroy(() => {
		window.removeEventListener('message', windowMessageEventHandler);
		bc.close();
		if (tokenTimer) clearInterval(tokenTimer);
		if (heartbeatInterval) clearInterval(heartbeatInterval);
	});
</script>

<svelte:head>
	<title>GoDoWorks Intelligent Systems</title>
	<link 
		crossorigin="anonymous" 
		rel="icon" 
		href="https://raw.githubusercontent.com/agustin-gdw/IA_GoDoWorks/7b312d5b7a77e35306d3b560b112cfed0c3a017e/static/static/ChatGPT%20Image%2023%20ene%202026%2C%2021_54_14.png" 
	/>
	<meta name="apple-mobile-web-app-title" content="GoDoWorks Intelligent Systems" />
	<meta 
		name="description" 
		content="GoDoWorks Intelligent Systems es una distribución diseñada por Agustin A. Sconamiglio en base a Open-WebUI para los sistemas internos de GoDoWorks." 
	/>
	<link
		rel="search"
		type="application/opensearchdescription+xml"
		title="GoDoWorks Intelligent Systems"
		href="/opensearch.xml"
		crossorigin="use-credentials"
	/>
</svelte:head>

{#if showRefresh}
	<div class="py-5">
		<Spinner className="size-5" />
	</div>
{/if}

{#if loaded}
	{#if $isApp}
		<div class="flex flex-row h-screen">
			<AppSidebar />
		<div class="w-full flex-1 max-w-[calc(100%-4.5rem)]">
			<slot />
		</div>
	</div>
{:else}
	<slot />
{/if}
{/if}

{#if $config?.features.enable_community_sharing}
	<SyncStatsModal bind:show={showSyncStatsModal} eventData={syncStatsEventData} />
{/if}

<Toaster
	theme={$theme.includes('dark')
		? 'dark'
		: $theme === 'system'
			? window.matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light'
			: 'light'}
	richColors
	position="top-right"
	closeButton
/>