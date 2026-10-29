<!--
  An ARIA 1.2 combobox over createAutocomplete. Unstyled beyond structure:
  colours, radius and font come from --asini-* tokens. Inside a <form>,
  Enter with no option chosen submits it natively (the field's name is `q`).
-->
<script lang="ts" generics="T">
  import { onDestroy, tick, type Snippet } from 'svelte';
  import { createAutocomplete, type AutocompleteOptions } from '../core/autocomplete.js';

  let {
    source,
    value = $bindable(''),
    label,
    placeholder,
    name = 'q',
    debounceMs,
    minLength,
    itemText = defaultText,
    itemKey,
    onselect,
    onsubmit,
    option,
    empty,
  }: {
    source: AutocompleteOptions<T>['source'];
    value?: string;
    /** Accessible name of the field. */
    label: string;
    placeholder?: string;
    name?: string;
    debounceMs?: number;
    minLength?: number;
    /** What an option shows and fills the field with. Default: `item.text`, or the item itself. */
    itemText?: (item: T) => string;
    itemKey?: (item: T, index: number) => string | number;
    /** An option was chosen (click or Enter); the field already holds its text. */
    onselect?: (item: T) => void;
    /** Enter with no option chosen. Without it, the surrounding form submits. */
    onsubmit?: (query: string) => void;
    option?: Snippet<[item: T, active: boolean]>;
    /** Shown when a finished search found nothing. Without it, the list stays shut. */
    empty?: Snippet<[query: string]>;
  } = $props();

  function defaultText(item: T): string {
    return typeof item === 'string' ? item : String((item as { text?: unknown }).text ?? '');
  }

  const id = $props.id();
  // svelte-ignore state_referenced_locally
  const ac = createAutocomplete<T>({
    source: (q, context) => source(q, context),
    debounceMs,
    minLength,
  });
  onDestroy(() => ac.close());

  let focused = $state(false);
  let composing = false;
  const showEmpty = $derived(!!empty && !$ac.loading && !$ac.error && $ac.query.trim() !== '' && $ac.items.length === 0);
  const open = $derived(focused && ($ac.items.length > 0 || showEmpty));
  const optionId = (i: number) => `${id}-option-${i}`;

  function choose(item: T) {
    value = itemText(item);
    ac.close();
    onselect?.(item);
  }

  async function keydown(e: KeyboardEvent) {
    if (e.isComposing || composing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!$ac.items.length) return;
      e.preventDefault();
      ac.move(e.key === 'ArrowDown' ? 1 : -1);
      await tick();
      document.getElementById(optionId($ac.active))?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const item = open ? ac.selected() : undefined;
      if (item !== undefined) { e.preventDefault(); choose(item); return; }
      ac.close();
      if (onsubmit) { e.preventDefault(); onsubmit(value); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); ac.close(); }
    }
  }
</script>

<div class="search-box" data-loading={$ac.loading || undefined}>
  <input
    id={`${id}-input`}
    type="search"
    role="combobox"
    {name}
    {placeholder}
    aria-label={label}
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={`${id}-list`}
    aria-activedescendant={open && $ac.active >= 0 ? optionId($ac.active) : undefined}
    autocomplete="off"
    spellcheck="false"
    bind:value
    oninput={() => { if (!composing) ac.input(value); }}
    onkeydown={keydown}
    onfocus={() => { focused = true; if (value) ac.input(value); }}
    onblur={() => { focused = false; ac.close(); }}
    oncompositionstart={() => { composing = true; }}
    oncompositionend={() => { composing = false; ac.input(value); }}
  />
  <ul id={`${id}-list`} role="listbox" aria-label={label} aria-busy={$ac.loading} hidden={!open}>
    {#if showEmpty}
      <li class="search-box-empty" role="presentation">{@render empty?.($ac.query)}</li>
    {/if}
    {#each $ac.items as item, i (itemKey ? itemKey(item, i) : i)}
      <!-- Keys live on the input (aria-activedescendant); options never take focus. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        id={optionId(i)}
        role="option"
        aria-selected={i === $ac.active}
        onmousedown={e => e.preventDefault()}
        onclick={() => choose(item)}
      >
        {#if option}{@render option(item, i === $ac.active)}{:else}{itemText(item)}{/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .search-box {
    position: relative;
    font-family: var(--asini-font-sans, inherit);
  }
  input {
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    padding: 0 0.875rem;
    font: inherit;
    font-size: max(16px, 1rem); /* below 16px iOS zooms the page on focus */
    color: var(--asini-text, inherit);
    background: var(--asini-surface, transparent);
    border: 1px solid var(--asini-border, color-mix(in srgb, currentColor 35%, transparent));
    border-radius: var(--asini-radius, 0.5rem);
  }
  input:focus-visible {
    outline: 2px solid var(--asini-accent, Highlight);
    outline-offset: 1px;
  }
  ul {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 0.25rem 0;
    list-style: none;
    max-height: min(22rem, 50dvh);
    overflow-y: auto;
    overscroll-behavior: contain;
    color: var(--asini-text, CanvasText);
    background: var(--asini-surface-raised, var(--asini-surface, Canvas));
    border: 1px solid var(--asini-border, GrayText);
    border-radius: var(--asini-radius, 0.5rem);
  }
  ul[hidden] {
    display: none;
  }
  li {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0.5rem 0.875rem;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  [aria-selected='true'],
  li[role='option']:hover {
    background: color-mix(in srgb, var(--asini-accent, Highlight) 12%, transparent);
  }
  .search-box-empty {
    cursor: default;
    color: var(--asini-text-2, GrayText);
  }
</style>
