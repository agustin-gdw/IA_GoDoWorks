<script>
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';

	import { onMount, getContext } from 'svelte';
	const i18n = getContext('i18n');

	import { page } from '$app/stores';
	import { config, models, settings } from '$lib/stores';

	import { getModelById, updateModelById } from '$lib/apis/models';

	import { getModels } from '$lib/apis';
	import ModelEditor from '$lib/components/workspace/Models/ModelEditor.svelte';

	let model = null;

	onMount(async () => {
		const _id = $page.url.searchParams.get('id');
		if (_id) {
			model = await getModelById(localStorage.token, _id).catch((e) => {
				return null;
			});

			if (!model) {
				goto('/workspace/models');
			}

			if (!model?.write_access) {
				toast.error($i18n.t('You do not have permission to edit this model'));
				goto('/workspace/models');
			}
		} else {
			goto('/workspace/models');
		}
	});

	const onSubmit = async (modelInfo) => {
		// Agregamos la lógica de fallback para el logo de GoDoWorks aquí también
		const updatedModelInfo = {
			...modelInfo,
			meta: {
				...modelInfo.meta,
				profile_image_url:
					modelInfo.meta.profile_image_url ?? 
					`https://raw.githubusercontent.com/agustin-gdw/IA_GoDoWorks/cee37eb2835262194239dd473d2f34d9ffa783fa/Favicon1%20(2).png`
			}
		};

		// Usamos updatedModelInfo en lugar del original
		const res = await updateModelById(localStorage.token, modelInfo.id, updatedModelInfo);

		if (res) {
			await models.set(
				await getModels(
					localStorage.token,
					$config?.features?.enable_direct_connections && ($settings?.directConnections ?? null)
				)
			);
			toast.success($i18n.t('Model updated successfully'));
			await goto('/workspace/models');
		}
	};
</script>

{#if model}
	<ModelEditor edit={true} {model} {onSubmit} />
{/if}
