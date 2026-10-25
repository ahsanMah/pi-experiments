<script lang="ts" module>
	// Small stroke icons drawn on a 16px grid, so the variant needs no icon dependency.
	const paths = {
		branch: "M5 2.5v7M5 9.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM5 4.5a2 2 0 1 0 0-4M11 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM11 6.5c0 3-6 2-6 5",
		edit: "M10.5 2.5l3 3L6 13H3v-3l7.5-7.5Z",
		share: "M6 9.5l4-3M6 6.5l4 3M4.5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM11.5 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM11.5 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
		pin: "M6 2h4l-.5 4 2.5 2.5H4L6.5 6 6 2ZM8 8.5V14",
		close: "M4 4l8 8M12 4l-8 8",
		compare: "M5.5 2v12M10.5 2v12M2 5h3.5M10.5 11H14M3 8h2.5M10.5 8H13",
		plus: "M8 3v10M3 8h10",
		note: "M3.5 2.5h6l3 3v8h-9v-11ZM9.5 2.5v3h3M5.5 8.5h5M5.5 11h3.5",
		sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M13 3l-1 1M4 12l-1 1",
		moon: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z",
		auto: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2ZM8 2v12M8 5h3.5M8 8h4.5M8 11h3.5",
		up: "M4 9.5l4-4 4 4",
		down: "M4 6.5l4 4 4-4",
		stop: "M4.5 4.5h7v7h-7z",
		send: "M3 8h9M8.5 4l4 4-4 4",
		grip: "M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01",
		map: "M2 4l4-1.5 4 1.5 4-1.5v9.5l-4 1.5-4-1.5-4 1.5V4ZM6 2.5V12M10 4v9.5",
		steer: "M2.5 8h7M7 4.5 10.5 8 7 11.5M13 3v10",
		tray: "M2.5 9.5h3l1 1.5h3l1-1.5h3M2.5 9.5 4 3.5h8l1.5 6v3.5h-11V9.5Z",
	} as const;
	export type IconName = keyof typeof paths;
</script>

<script lang="ts">
	let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<path d={paths[name]} />
</svg>
