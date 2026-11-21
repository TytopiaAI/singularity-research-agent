import { scrollbarCss } from '../shared/scrollbar-style'

if (!document.getElementById('singularity-scrollbars')) {
  const style = document.createElement('style')
  style.id = 'singularity-scrollbars'
  style.textContent = scrollbarCss
  document.head.append(style)
}
