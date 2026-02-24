<script lang="ts">
	type Props = {
		id: string;
		label: string;
		placeholder?: string;
		value?: string;
	};

	let { id, label, placeholder = '', value = $bindable('') }: Props = $props();
</script>

<div class="neo-field">
	<label for={id}>{label}</label>
	<input class="neo-input" {id} bind:value placeholder={placeholder} autocomplete="off" />
</div>
