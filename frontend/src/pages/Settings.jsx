import { useState, useEffect, useCallback } from 'react'
import api from '../api.js'

// ─── Tab 1: Categories ────────────────────────────────────────────────────────
function CategoriesTab() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingBudget, setEditingBudget] = useState({}) // { id/name: value }
  const [savingBudget, setSavingBudget] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/expenses/categories')
      const data = Array.isArray(res.data) ? res.data : []
      setCategories(data.map(c => typeof c === 'string' ? { name: c, monthly_budget: null } : c))
    } catch {
      setError('Failed to load categories.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  function flash(msg) {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 3000)
  }

  async function handleAddCategory() {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    setError('')
    try {
      await api.post('/expenses/categories', { name, monthly_budget: null })
      setNewName('')
      await fetchCategories()
      flash('Category added.')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add category.')
    } finally {
      setAdding(false)
    }
  }

  async function handleSaveBudget(cat) {
    const key = cat.id ?? cat.name
    const rawVal = editingBudget[key]
    if (rawVal === undefined) return
    const budget = rawVal === '' ? null : parseFloat(rawVal)
    if (rawVal !== '' && isNaN(budget)) return
    setSavingBudget(key)
    try {
      const id = cat.id ?? cat.name
      await api.patch(`/expenses/categories/${encodeURIComponent(id)}`, { monthly_budget: budget })
      setEditingBudget(e => { const n = { ...e }; delete n[key]; return n })
      setCategories(prev => prev.map(c => (c.id ?? c.name) === key ? { ...c, monthly_budget: budget } : c))
      flash('Budget updated.')
    } catch {
      setError('Failed to update budget.')
    } finally {
      setSavingBudget(null)
    }
  }

  async function handleDelete(cat) {
    const id = cat.id ?? cat.name
    setDeletingId(id)
    try {
      await api.delete(`/expenses/categories/${encodeURIComponent(id)}`)
      setCategories(prev => prev.filter(c => (c.id ?? c.name) !== id))
      setConfirmDelete(null)
      flash('Category deleted.')
    } catch {
      setError('Failed to delete category.')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /><span>Loading...</span></div>

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Add category */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          className="input"
          placeholder="New category name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
          style={{ maxWidth: 300 }}
        />
        <button className="btn btn-primary" onClick={handleAddCategory} disabled={adding || !newName.trim()}>
          {adding ? <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> Adding...</> : '+ Add Category'}
        </button>
      </div>

      {categories.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏷️</div>
          <h3>No categories yet</h3>
          <p>Add your first expense category above.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Category Name</th>
                <th style={{ textAlign: 'right', width: 220 }}>Monthly Budget (₹)</th>
                <th style={{ textAlign: 'center', width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => {
                const key = cat.id ?? cat.name
                const editVal = editingBudget[key]
                const isEditing = editVal !== undefined
                return (
                  <tr key={key}>
                    <td style={{ fontWeight: 500 }}>{cat.name}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        {isEditing ? (
                          <>
                            <input
                              type="number"
                              className="input"
                              value={editVal}
                              onChange={e => setEditingBudget(eb => ({ ...eb, [key]: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && handleSaveBudget(cat)}
                              placeholder="No limit"
                              style={{ width: 110, textAlign: 'right' }}
                              autoFocus
                              min="0"
                              step="100"
                            />
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleSaveBudget(cat)}
                              disabled={savingBudget === key}
                            >
                              {savingBudget === key ? <span className="spinner" style={{ width: 12, height: 12, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> : 'Save'}
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setEditingBudget(eb => { const n = { ...eb }; delete n[key]; return n })}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize: 14, color: cat.monthly_budget ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {cat.monthly_budget ? `₹${Number(cat.monthly_budget).toLocaleString('en-IN')}` : 'No limit'}
                            </span>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditingBudget(eb => ({ ...eb, [key]: cat.monthly_budget ?? '' }))}
                              style={{ color: 'var(--accent)' }}
                            >
                              ✏️
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {confirmDelete === key ? (
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(cat)}
                            disabled={deletingId === key}
                          >
                            {deletingId === key ? '...' : 'Confirm'}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(null)}>No</button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setConfirmDelete(key)}
                          style={{ color: 'var(--danger)' }}
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Tab 2: Vendor Mappings ───────────────────────────────────────────────────
function VendorMappingsTab() {
  const [mappings, setMappings] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [newKeyword, setNewKeyword] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [mappRes, catRes] = await Promise.all([
        api.get('/expenses/vendor-mappings'),
        api.get('/expenses/categories'),
      ])
      setMappings(mappRes.data ?? [])
      const cats = Array.isArray(catRes.data) ? catRes.data : []
      setCategories(cats.map(c => (typeof c === 'string' ? c : c.name)))
    } catch {
      setError('Failed to load vendor mappings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function flash(msg) {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 3000)
  }

  async function handleAdd() {
    if (!newKeyword.trim() || !newCategory) return
    setAdding(true)
    setError('')
    try {
      await api.post('/expenses/vendor-mappings', {
        keyword: newKeyword.trim(),
        category: newCategory,
      })
      setNewKeyword('')
      setNewCategory('')
      await fetchData()
      flash('Mapping added.')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add mapping.')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(mapping) {
    const id = mapping.id ?? mapping.keyword
    setDeletingId(id)
    try {
      await api.delete(`/expenses/vendor-mappings/${encodeURIComponent(mapping.id ?? mapping.keyword)}`)
      setMappings(prev => prev.filter(m => (m.id ?? m.keyword) !== id))
      flash('Mapping deleted.')
    } catch {
      setError('Failed to delete mapping.')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /><span>Loading...</span></div>

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Add new mapping */}
      <div
        className="card"
        style={{ marginBottom: 20, padding: '16px 20px', background: 'var(--bg-secondary)', boxShadow: 'none' }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Add Vendor Mapping
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Keyword (e.g. SWIGGY, ZOMATO)"
            value={newKeyword}
            onChange={e => setNewKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={{ flex: '1 1 160px', fontFamily: 'monospace' }}
          />
          <select
            className="select"
            value={newCategory}
            onChange={e => setNewCategory(e.target.value)}
            style={{ flex: '1 1 160px' }}
          >
            <option value="">Select category</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={adding || !newKeyword.trim() || !newCategory}
          >
            {adding ? <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> Adding...</> : '+ Add'}
          </button>
        </div>
        <p className="helper-text" style={{ marginTop: 8 }}>
          Keywords are matched case-insensitively against vendor names in incoming transactions.
        </p>
      </div>

      {mappings.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔗</div>
          <h3>No vendor mappings yet</h3>
          <p>Add keyword → category rules to auto-categorize transactions.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Maps to Category</th>
                <th style={{ textAlign: 'center', width: 80 }}>Delete</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m, i) => {
                const key = m.id ?? m.keyword
                return (
                  <tr key={key ?? i}>
                    <td>
                      <code style={{ fontSize: 13, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
                        {m.keyword}
                      </code>
                    </td>
                    <td>
                      <span className="badge badge-info">{m.category}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDelete(m)}
                        disabled={deletingId === key}
                        style={{ color: 'var(--danger)' }}
                      >
                        {deletingId === key ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '🗑️'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Tab 3: About/Info ────────────────────────────────────────────────────────
function AboutTab() {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/setup/info').then(res => {
      setInfo(res.data)
    }).catch(() => {
      setInfo(null)
    }).finally(() => setLoading(false))
  }, [])

  const baseUrl = window.location.origin

  return (
    <div>
      {/* App info */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-title">App Information</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3 }}>Version</div>
            <div style={{ fontWeight: 600 }}>{loading ? '...' : (info?.version ?? '1.0.0')}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3 }}>Storage Path</div>
            <code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
              {loading ? '...' : (info?.storage_path ?? '~/finance-app/storage/')}
            </code>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3 }}>Webhook URL</div>
            <code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4, wordBreak: 'break-all' }}>
              {baseUrl}/webhook/sms
            </code>
          </div>
        </div>
      </div>

      {/* iPhone Shortcut reminder */}
      <div className="card">
        <div className="section-title">iPhone Shortcut Setup</div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Set up an iOS Shortcut to automatically forward bank SMS alerts to this app.
        </p>

        <ol style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            {
              n: 1,
              text: 'Open the Shortcuts app on your iPhone.',
            },
            {
              n: 2,
              text: 'Go to Automation → tap "+" → choose "Message" as trigger. Filter by bank name.',
            },
            {
              n: 3,
              text: (
                <>
                  Add a "Get Contents of URL" action. Set URL to{' '}
                  <code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: 4 }}>
                    {baseUrl}/webhook/sms
                  </code>
                </>
              ),
            },
            {
              n: 4,
              text: 'Set Method: POST. Add header X-Webhook-Secret with your webhook secret from setup.',
            },
            {
              n: 5,
              text: 'Set body to JSON with keys "text" (Message Content variable) and "sender" (Sender Name variable).',
            },
            {
              n: 6,
              text: 'Save the shortcut and test it by triggering with a sample message.',
            },
          ].map(step => (
            <li key={step.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {step.n}
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────
const TABS = [
  { id: 'categories', label: 'Categories' },
  { id: 'vendors', label: 'Vendor Mappings' },
  { id: 'about', label: 'About' },
]

export default function Settings() {
  const [activeTab, setActiveTab] = useState('categories')

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Manage categories, vendor mappings, and app info</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'categories' && <CategoriesTab />}
      {activeTab === 'vendors' && <VendorMappingsTab />}
      {activeTab === 'about' && <AboutTab />}
    </div>
  )
}
