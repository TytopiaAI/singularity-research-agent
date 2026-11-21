import { scrollbarCss } from '../shared/scrollbar-style'
export const chatAppearanceCss = scrollbarCss + String.raw`
  html[data-singularity-chat-theme="warm"] .wSkVaW_heroGlow {
    background: radial-gradient(ellipse at center, rgba(244,218,140,.50), transparent 68%) !important;
    opacity: .28 !important;
  }
  #singularity-chat-appearance {
    position: fixed; right: 18px; bottom: 18px; z-index: 200;
    font: 12px/1.4 "Segoe UI Variable Text", "Segoe UI", "Singularity Han", "Microsoft YaHei UI", sans-serif;
    color: #6e6e73; --picker-bg: rgba(250,250,252,.9); --picker-line: rgba(0,0,0,.07);
  }
  body[data-ds-dark-theme] #singularity-chat-appearance {
    color: #a1a1a6; --picker-bg: rgba(40,40,43,.92); --picker-line: rgba(255,255,255,.09);
  }
  #singularity-chat-appearance button { font: inherit; color: inherit; cursor: pointer; }
  #singularity-chat-appearance .chat-theme-trigger {
    display: grid; place-items: center; width: 38px; height: 38px; padding: 0;
    border: 1px solid var(--picker-line); border-radius: 50%; background: var(--picker-bg);
    box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 6px 18px rgba(0,0,0,.08); backdrop-filter: blur(24px) saturate(180%);
  }
  #singularity-chat-appearance .chat-theme-trigger:hover { color: #F0694A; }
  #singularity-chat-appearance .chat-theme-panel {
    position: absolute; right: 0; bottom: 50px; width: min(312px, calc(100vw - 36px));
    box-sizing: border-box; padding: 16px; border: 1px solid var(--picker-line); border-radius: 16px;
    background: var(--picker-bg); box-shadow: 0 2px 6px rgba(0,0,0,.06), 0 18px 48px rgba(0,0,0,.16); backdrop-filter: blur(30px) saturate(180%);
  }
  #singularity-chat-appearance .chat-theme-panel[hidden] { display: none; }
  #singularity-chat-appearance strong { display: block; margin-bottom: 12px; color: inherit; font-size: 13px; font-weight: 600; }
  #singularity-chat-appearance .chat-theme-options { display: grid; grid-template-columns: repeat(5,1fr); gap: 6px; }
  #singularity-chat-appearance .chat-theme-option {
    display: grid; justify-items: center; gap: 7px; padding: 7px 3px; border: 1px solid transparent;
    border-radius: 12px; background: transparent; font-size: 11px;
  }
  #singularity-chat-appearance .chat-theme-option:hover { background: rgba(110,120,138,.07); }
  #singularity-chat-appearance .chat-theme-option[aria-checked="true"] { border-color: transparent; background: rgba(255,126,95,.12); color: #C2452A; }
  #singularity-chat-appearance .chat-theme-swatch {
    display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%;
    background: var(--swatch); box-shadow: inset 0 0 0 1px rgba(50,60,75,.06);
  }
  #singularity-chat-appearance .chat-theme-swatch.is-transparent {
    background: conic-gradient(#dbe1e5 25%, #f8f9fa 0 50%, #dbe1e5 0 75%, #f8f9fa 0) 0 0/12px 12px;
  }
  #singularity-chat-appearance [aria-checked="true"] .chat-theme-swatch::after {
    content: ''; width: 11px; height: 6px; border: solid white; border-width: 0 0 2px 2px; transform: rotate(-45deg) translateY(-1px);
  }
  #singularity-chat-appearance [data-chat-theme="transparent"][aria-checked="true"] .chat-theme-swatch::after { border-color: #516174; }
  #singularity-chat-appearance [data-chat-theme="warm"][aria-checked="true"] .chat-theme-swatch::after { border-color: #8d682a; }
  #singularity-chat-appearance .chat-theme-error:empty { display: none; }
  #singularity-chat-appearance .chat-theme-error { margin-top: 10px; color: #b94835; }
`
