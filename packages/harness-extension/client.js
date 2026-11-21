// The host and client share this package ID. Only expose panel selection and the @ menu, never the service context.
window.__ModuleLoader__.load({ id: '@singularity/harness-extension', factory() {
  return { inject: ['layout', 'inputTriggers'], apply(ctx) {
    const select = event => {
      if (!['plugins', 'assistant'].includes(event.detail)) return
      ctx.layout.selectPanel(event.detail === 'plugins' ? 'plugins' : null)
      document.body.dataset.singularityPanel = event.detail
    }
    ctx.effect(() => {
      window.addEventListener('singularity:select-panel', select)
      document.documentElement.dataset.singularityNavigationReady = 'true'
      return () => {
        window.removeEventListener('singularity:select-panel', select)
        delete document.documentElement.dataset.singularityNavigationReady
      }
    })
    let catalog = null
    let catalogAt = 0
    const loadCatalog = () => {
      const list = window.dshDesktop && window.dshDesktop.mentions && window.dshDesktop.mentions.list
      if (!list) return Promise.resolve({ fields: [], papers: [] })
      if (catalog && Date.now() - catalogAt < 4000) return Promise.resolve(catalog)
      catalogAt = Date.now()
      return list().then((value) => { catalog = value && Array.isArray(value.fields) && Array.isArray(value.papers) ? value : { fields: [], papers: [] }; return catalog }).catch(() => ({ fields: [], papers: [] }))
    }
    const row = (item) => ({ name: item.title, description: item.detail || (item.kind === 'field' ? '领域' : '论文库'), icon: item.kind === 'field' ? 'folder' : 'file', section: item.kind === 'field' ? '领域' : '论文', value: JSON.stringify({ kind: item.kind, title: item.title, mention: item.mention }) })
    ctx.effect(() => ctx.get('inputTriggers').registerSource({
      trigger: '@',
      name: 'singularity',
      order: -10,
      showGroupTitle: false,
      async candidates(_session, { query, quoted }) {
        if (quoted) return []
        const needle = String(query || '').trim().toLowerCase()
        const data = await loadCatalog()
        const match = (item) => !needle || String(item.title || '').toLowerCase().includes(needle)
        return [...data.fields.filter(match).slice(0, 20).map(row), ...data.papers.filter(match).slice(0, 12).map(row)]
      },
      onPick({ candidate }) {
        let value
        try { value = JSON.parse(candidate.value) } catch { return }
        if (!value || (value.kind !== 'field' && value.kind !== 'paper') || typeof value.mention !== 'string' || typeof value.title !== 'string') return
        return { insert: { source: 'singularity', ref: value.mention, label: value.title, appearance: value.kind === 'field' ? 'folder' : 'file', clipboardText: value.mention } }
      },
      codec: { clipboardText: (ref) => ref, serialize: (ref) => Promise.resolve(ref) },
    }), 'singularity: @ fields and papers')
  } }
} })
