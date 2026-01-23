<script lang="ts">
	import { WEBUI_BASE_URL } from '$lib/constants';

	export let className = 'size-8';
	export let src = `https://raw.githubusercontent.com/agustin-gdw/IA_GoDoWorks/368d8bfa46b4b3d6999badea023948e4b51bd74e/Favicon1.png`;
</script>

<img
	aria-hidden="true"
	src={src === ''
		? `https://raw.githubusercontent.com/agustin-gdw/IA_GoDoWorks/368d8bfa46b4b3d6999badea023948e4b51bd74e/Favicon1.png`
		: src.startsWith(WEBUI_BASE_URL) ||
			  src.startsWith('https://www.gravatar.com/avatar/') ||
			  src.startsWith('data:') ||
			  src.startsWith('/')
			? src
			: `${WEBUI_BASE_URL}/user.png`}
	class=" {className} object-cover rounded-full"
	alt="profile"
	draggable="false"
/>
