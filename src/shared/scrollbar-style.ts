// Shared by the React shell and the separate assistant web view.
export const scrollbarCss = String.raw`
  :root { --scroll-thumb: rgba(60,60,67,.22); --scroll-thumb-hover: rgba(60,60,67,.42); }
  :root[data-theme="dark"], body[data-ds-dark-theme] { --scroll-thumb: rgba(235,235,245,.22); --scroll-thumb-hover: rgba(235,235,245,.42); }
  *::-webkit-scrollbar { width: 10px; height: 10px; }
  *::-webkit-scrollbar-track, *::-webkit-scrollbar-corner { background: transparent; }
  *::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border: 3px solid transparent; background-clip: padding-box; border-radius: 20px; min-height: 36px; }
  *::-webkit-scrollbar-thumb:hover { background-color: var(--scroll-thumb-hover); }
  *::-webkit-scrollbar-thumb:active { background-color: var(--scroll-thumb-hover); }
  *::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
  @supports not selector(::-webkit-scrollbar) { * { scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) transparent; } }
  @media (forced-colors: active) { * { scrollbar-color: auto; } *::-webkit-scrollbar-thumb { background: CanvasText; } }
`
