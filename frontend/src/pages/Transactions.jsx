import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api.js'

const PAGE_SIZE = 20

// ─── Shared transaction form fields ──────────────────────────────────────────
function TxnForm({ form, setField, categories, error }) {
  return (
    <>
      {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="form-row">
        <div className="form-group">
          <label>Date</label>
          <input type="date" className="input" value={form.date}
            onChange={e => setField('date', e.target.value)}
            max={new Date().toISOString().split('T')[0]} />
        </div>
        <div className="form-group">
          <label>Direction</label>
          <select className="select" value={form.direction} onChange={e => setField('direction', e.target.value)}>
            <option value="debit">Debit (Expense)</option>
            <option value="credit">Credit (Income)</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Amount (₹)</label>
          <input type="number" className="input" placeholder="0.00" value={form.amount}
            onChange={e => setField('amount', e.target.value)} step="0.01" min="0" />
        </div>
        <div className="form-group">
          <label>Category</label>
          <select className="select" value={form.category} onChange={e => setField('category', e.target.value)}>
            <option value="">Select category</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label>Vendor / Description</label>
        <input className="input" placeholder="e.g. Swiggy, Amazon" value={form.vendor}
          onChange={e => setField('vendor', e.target.value)} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Bank</label>
          <input className="input" placeholder="e.g. HDFC Bank" value={form.bank || ''}
            onChange={e => setField('bank', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Account last 4</label>
          <input className="input" placeholder="e.g. 1405" maxLength={4} value={form.account_last4 || ''}
            onChange={e => setField('account_last4', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>UPI Ref</label>
          <input className="input" placeholder="Optional" value={form.upi_ref || ''}
            onChange={e => setField('upi_ref', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <input className="input" placeholder="Optional" value={form.notes || ''}
            onChange={e => setField('notes', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Amortise over (months) <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>— for annual/multi-month expenses like gym, insurance</span></label>
        <input className="input" type="number" min={2} max={120} placeholder="Leave blank for one-time"
          value={form.amortise_months || ''}
          onChange={e => setField('amortise_months', e.target.value ? parseInt(e.target.value) : null)} />
      </div>
    </>
  )
}

// ─── Add Transaction Modal ────────────────────────────────────────────────────
function AddTransactionModal({ categories, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '', direction: 'debit', vendor: '',
    category: '', notes: '', bank: '', account_last4: '', upi_ref: '', amortise_months: null,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.amount || isNaN(form.amount) || Number(form.amount) <= 0)
      return setError('Enter a valid amount.')
    if (!form.vendor.trim()) return setError('Vendor is required.')
    setError('')
    setSubmitting(true)
    try {
      await api.post('/expenses/transactions', {
        date: form.date, amount: parseFloat(form.amount),
        direction: form.direction, vendor: form.vendor.trim(),
        category: form.category || 'Miscellaneous',
        notes: form.notes.trim() || null,
        bank: form.bank || null, account_last4: form.account_last4 || null,
        upi_ref: form.upi_ref || null,
        amortise_months: form.amortise_months || null,
      })
      onSaved()
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to add transaction.'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Add Transaction</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, padding: '4px 8px' }}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <TxnForm form={form} setField={setField} categories={categories} error={error} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> Adding...</> : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Edit Transaction Modal ───────────────────────────────────────────────────
function EditTransactionModal({ txn, categories, onClose, onSaved }) {
  const [form, setForm] = useState({
    date:           txn.date ?? '',
    amount:         txn.amount ?? '',
    direction:      txn.direction ?? 'debit',
    vendor:         txn.vendor ?? '',
    category:       txn.category ?? '',
    bank:           txn.bank ?? '',
    account_last4:  txn.account_last4 ?? '',
    upi_ref:        txn.upi_ref ?? '',
    notes:          txn.notes ?? '',
    amortise_months: txn.amortise_months ?? null,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.amount || isNaN(form.amount) || Number(form.amount) <= 0)
      return setError('Enter a valid amount.')
    if (!form.vendor.trim()) return setError('Vendor is required.')
    setError('')
    setSubmitting(true)
    try {
      const res = await api.patch(`/expenses/transactions/${txn.id}`, {
        date:           form.date,
        amount:         parseFloat(form.amount),
        direction:      form.direction,
        vendor:         form.vendor.trim(),
        category:       form.category || 'Miscellaneous',
        bank:           form.bank || null,
        account_last4:  form.account_last4 || null,
        upi_ref:        form.upi_ref || null,
        notes:          form.notes.trim() || null,
        amortise_months: form.amortise_months || null,
      })
      onSaved(res.data)
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to save.'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Edit Transaction</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, padding: '4px 8px' }}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <TxnForm form={form} setField={setField} categories={categories} error={error} />
            {txn.raw_text && (
              <div className="form-group">
                <label>Raw text (read-only)</label>
                <textarea className="input" readOnly value={txn.raw_text}
                  rows={2} style={{ fontSize: 12, color: 'var(--text-secondary)', resize: 'none' }} />
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> Saving...</> : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirmModal({ txn, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.delete(`/expenses/transactions/${txn.id}`)
      onDeleted(txn.id)
    } catch {
      setDeleting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <h2>Delete Transaction</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, padding: '4px 8px' }}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 10 }}>Are you sure you want to delete this transaction?</p>
          <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 14 }}>
            <strong>{txn.vendor}</strong> · ₹{Number(txn.amount).toLocaleString('en-IN')} · {txn.date}
          </div>
          <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-secondary)' }}>This cannot be undone.</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Inline category editor ───────────────────────────────────────────────────
function CategoryCell({ txnId, currentCategory, categories, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const selectRef = useRef(null)

  useEffect(() => {
    if (editing && selectRef.current) selectRef.current.focus()
  }, [editing])

  async function handleChange(newCategory) {
    if (newCategory === currentCategory) { setEditing(false); return }
    setSaving(true)
    try {
      await api.patch(`/expenses/transactions/${txnId}/category`, { category: newCategory })
      onUpdated(txnId, newCategory)
    } catch { } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (saving) return <span className="spinner" style={{ width: 14, height: 14 }} />
  if (editing) {
    return (
      <select ref={selectRef} className="select" defaultValue={currentCategory || ''}
        onChange={e => handleChange(e.target.value)} onBlur={() => setEditing(false)}
        style={{ fontSize: 13, padding: '4px 28px 4px 8px', minWidth: 120 }}>
        <option value="">Uncategorized</option>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    )
  }

  return (
    <span title="Click to edit category" onClick={() => setEditing(true)} style={{
      cursor: 'pointer', padding: '3px 8px', borderRadius: 100,
      fontSize: 12, fontWeight: 500, background: 'var(--bg-secondary)',
      color: 'var(--text-secondary)', border: '1px solid var(--border)',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {currentCategory || 'Uncategorized'}
      <span style={{ fontSize: 10, opacity: 0.6 }}>✏️</span>
    </span>
  )
}

// ─── Inline amortise editor ───────────────────────────────────────────────────
function AmortiseCell({ txn, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(txn.amortise_months ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function handleSave() {
    const months = value === '' ? null : parseInt(value)
    if (months !== null && (isNaN(months) || months < 2)) return
    setSaving(true)
    try {
      await api.patch(`/expenses/transactions/${txn.id}`, { amortise_months: months })
      onUpdated(txn.id, months)
      setEditing(false)
    } catch { } finally {
      setSaving(false)
    }
  }

  if (saving) return <span className="spinner" style={{ width: 14, height: 14 }} />

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          ref={inputRef} type="number" min={2} max={120}
          className="input" placeholder="months"
          value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
          style={{ width: 70, padding: '3px 6px', fontSize: 12 }}
        />
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: '2px 5px' }} onClick={handleSave}>✓</button>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: '2px 5px' }} onClick={() => { setEditing(false); setValue(txn.amortise_months ?? '') }}>✕</button>
      </div>
    )
  }

  if (txn.amortise_months) {
    return (
      <span title="Click to edit amortisation" onClick={() => setEditing(true)} style={{
        cursor: 'pointer', fontSize: 11, padding: '2px 7px', borderRadius: 100,
        background: 'rgba(59,130,246,0.1)', color: 'var(--accent)',
        border: '1px solid rgba(59,130,246,0.25)', display: 'inline-flex', alignItems: 'center', gap: 3,
      }}>
        📅 {txn.amortise_months}mo <span style={{ fontSize: 10, opacity: 0.6 }}>✏️</span>
      </span>
    )
  }

  return (
    <span title="Amortise this expense" onClick={() => setEditing(true)} style={{
      cursor: 'pointer', fontSize: 11, padding: '2px 7px', borderRadius: 100,
      background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
      border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', gap: 3,
    }}>
      + amortise
    </span>
  )
}

// ─── Expanded row ─────────────────────────────────────────────────────────────
function ExpandedRow({ txn, colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'var(--bg-secondary)', padding: '10px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px', fontSize: 13 }}>
          {txn.raw_text && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 6 }}>Raw SMS:</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{txn.raw_text}</span>
            </div>
          )}
          {txn.file_path && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 6 }}>File:</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>
                {txn.file_path.split('/').pop()}
              </span>
            </div>
          )}
          {txn.bank && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 6 }}>Bank:</span>
              {txn.bank}{txn.account_last4 ? ` *${txn.account_last4}` : ''}
            </div>
          )}
          {txn.upi_ref && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 6 }}>UPI Ref:</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{txn.upi_ref}</span>
            </div>
          )}
          {txn.notes && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 6 }}>Notes:</span>
              {txn.notes}
            </div>
          )}
          {txn.source_type && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 6 }}>Source:</span>
              {txn.source_type.replace(/_/g, ' ')}
            </div>
          )}
          {txn.amortise_months && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 6 }}>Amortised:</span>
              ₹{(txn.amount / txn.amortise_months).toLocaleString('en-IN', { maximumFractionDigits: 0 })}/month over {txn.amortise_months} months
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── Split Expense Modal ──────────────────────────────────────────────────────
function SplitModal({ txn, onClose, onSaved }) {
  const [people, setPeople] = useState(2)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const yourShare = people > 0 ? txn.amount / people : 0
  const othersOwe = txn.amount - yourShare

  async function handleSubmit(e) {
    e.preventDefault()
    if (people < 2) return setError('Must be at least 2 people.')
    setError('')
    setSubmitting(true)
    try {
      await api.post('/expenses/splits', {
        transaction_id: txn.id,
        total_people: people,
        notes: notes.trim() || null,
      })
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create split.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2>Split Expense</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, padding: '4px 8px' }}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

            <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{txn.vendor}</div>
              <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>₹{Number(txn.amount).toLocaleString('en-IN')} · {txn.date}</div>
            </div>

            <div className="form-group">
              <label>Number of people (including you)</label>
              <input
                type="number" className="input" min={2} max={20}
                value={people} onChange={e => setPeople(parseInt(e.target.value) || 2)}
              />
            </div>

            <div className="form-group">
              <label>Notes (optional — e.g. who you split with)</label>
              <input className="input" placeholder="e.g. Priya, Arjun" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            {people >= 2 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Your share</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>₹{yourShare.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                </div>
                <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Others owe you</div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--success)' }}>₹{othersOwe.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> Saving...</> : 'Mark as Split'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Transactions Page ───────────────────────────────────────────────────
export default function Transactions() {
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editTxn, setEditTxn] = useState(null)
  const [deleteTxn, setDeleteTxn] = useState(null)
  const [splitTxn, setSplitTxn] = useState(null)
  const [error, setError] = useState('')

  const [filters, setFilters] = useState({ start: '', end: '', category: '', vendor: '', direction: '' })
  const [debouncedVendor, setDebouncedVendor] = useState('')
  const vendorDebounce = useRef(null)

  function setFilter(k, v) { setFilters(f => ({ ...f, [k]: v })); setPage(1) }

  function handleVendorInput(v) {
    setFilters(f => ({ ...f, vendor: v }))
    clearTimeout(vendorDebounce.current)
    vendorDebounce.current = setTimeout(() => { setDebouncedVendor(v); setPage(1) }, 400)
  }

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get('/expenses/categories')
      setCategories(Array.isArray(res.data) ? res.data.map(c => typeof c === 'string' ? c : c.name) : [])
    } catch { setCategories([]) }
  }, [])

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('page', page)
      params.set('page_size', PAGE_SIZE)
      if (filters.start) params.set('start', filters.start)
      if (filters.end) params.set('end', filters.end)
      if (filters.category) params.set('category', filters.category)
      if (debouncedVendor) params.set('vendor', debouncedVendor)
      if (filters.direction) params.set('direction', filters.direction)
      const res = await api.get(`/expenses/transactions?${params}`)
      const data = res.data
      setTransactions(data.transactions ?? data.items ?? data ?? [])
      setTotal(data.total ?? data.count ?? (data.transactions ?? data.items ?? data ?? []).length)
    } catch { setError('Failed to load transactions.') }
    finally { setLoading(false) }
  }, [page, filters.start, filters.end, filters.category, debouncedVendor, filters.direction])

  useEffect(() => { fetchCategories() }, [fetchCategories])
  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  function handleCategoryUpdated(txnId, newCat) {
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, category: newCat } : t))
  }

  function handleAmortiseUpdated(txnId, months) {
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, amortise_months: months } : t))
  }

  function handleEdited(updated) {
    setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t))
    setEditTxn(null)
  }

  function handleDeleted(id) {
    setTransactions(prev => prev.filter(t => t.id !== id))
    setTotal(n => n - 1)
    setDeleteTxn(null)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Transactions</div>
          <div className="page-subtitle">{total} transaction{total !== 1 ? 's' : ''} found</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add Transaction</button>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Start Date</label>
            <input type="date" className="input" value={filters.start} onChange={e => setFilter('start', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>End Date</label>
            <input type="date" className="input" value={filters.end} onChange={e => setFilter('end', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Category</label>
            <select className="select" value={filters.category} onChange={e => setFilter('category', e.target.value)}>
              <option value="">All</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Vendor</label>
            <input className="input" placeholder="Search vendor..." value={filters.vendor} onChange={e => handleVendorInput(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Direction</label>
            <select className="select" value={filters.direction} onChange={e => setFilter('direction', e.target.value)}>
              <option value="">All</option>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
          </div>
          {(filters.start || filters.end || filters.category || filters.vendor || filters.direction) && (
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => {
                setFilters({ start: '', end: '', category: '', vendor: '', direction: '' })
                setDebouncedVendor('')
                setPage(1)
              }}>Clear Filters</button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><div className="spinner" /><span>Loading transactions...</span></div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💳</div>
            <h3>No transactions found</h3>
            <p>Try adjusting your filters or add a transaction manually.</p>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Type</th>
                    <th>Amortise</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn, i) => {
                    const isCredit = txn.direction === 'credit'
                    const isExpanded = expanded === (txn.id ?? i)
                    const dateStr = txn.date
                      ? new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                      : '—'

                    return [
                      <tr key={txn.id ?? i}>
                        <td onClick={() => setExpanded(p => p === (txn.id ?? i) ? null : (txn.id ?? i))} style={{ cursor: 'pointer' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', userSelect: 'none' }}>
                            {isExpanded ? '▾' : '▸'}
                          </span>
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{dateStr}</td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 14, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {txn.vendor || '—'}
                          </div>
                        </td>
                        <td>
                          <CategoryCell txnId={txn.id} currentCategory={txn.category}
                            categories={categories} onUpdated={handleCategoryUpdated} />
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 14, color: isCredit ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                          {isCredit ? '+' : '-'}₹{Number(txn.amount ?? 0).toLocaleString('en-IN')}
                          {txn.amortise_months && (
                            <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)' }}>
                              ₹{(txn.amount / txn.amortise_months).toLocaleString('en-IN', { maximumFractionDigits: 0 })}/mo × {txn.amortise_months}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${isCredit ? 'badge-success' : 'badge-danger'}`}>
                            {isCredit ? 'Credit' : 'Debit'}
                          </span>
                        </td>
                        <td>
                          {!isCredit && (
                            <AmortiseCell txn={txn} onUpdated={handleAmortiseUpdated} />
                          )}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-sm" title="Edit"
                            onClick={() => setEditTxn(txn)}
                            style={{ fontSize: 14, padding: '3px 7px', marginRight: 2 }}>
                            ✏️
                          </button>
                          {!isCredit && (
                            <button className="btn btn-ghost btn-sm" title="Split"
                              onClick={() => setSplitTxn(txn)}
                              style={{ fontSize: 14, padding: '3px 7px', marginRight: 2 }}>
                              🔀
                            </button>
                          )}
                          <button className="btn btn-ghost btn-sm" title="Delete"
                            onClick={() => setDeleteTxn(txn)}
                            style={{ fontSize: 14, padding: '3px 7px', color: 'var(--danger)' }}>
                            🗑
                          </button>
                        </td>
                      </tr>,
                      isExpanded && <ExpandedRow key={`exp-${txn.id ?? i}`} txn={txn} colSpan={8} />,
                    ]
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="pagination" style={{ padding: '12px 16px' }}>
                <button className="pagination-btn" onClick={() => setPage(1)} disabled={page === 1}>«</button>
                <button className="pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let n
                  if (totalPages <= 7) n = i + 1
                  else if (page <= 4) n = i + 1
                  else if (page >= totalPages - 3) n = totalPages - 6 + i
                  else n = page - 3 + i
                  return <button key={n} className={`pagination-btn ${n === page ? 'active' : ''}`} onClick={() => setPage(n)}>{n}</button>
                })}
                <button className="pagination-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
                <button className="pagination-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</button>
              </div>
            )}
          </>
        )}
      </div>

      {showAddModal && (
        <AddTransactionModal categories={categories}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); fetchTransactions() }} />
      )}

      {editTxn && (
        <EditTransactionModal txn={editTxn} categories={categories}
          onClose={() => setEditTxn(null)}
          onSaved={handleEdited} />
      )}

      {deleteTxn && (
        <DeleteConfirmModal txn={deleteTxn}
          onClose={() => setDeleteTxn(null)}
          onDeleted={handleDeleted} />
      )}

      {splitTxn && (
        <SplitModal txn={splitTxn}
          onClose={() => setSplitTxn(null)}
          onSaved={() => setSplitTxn(null)} />
      )}
    </div>
  )
}
