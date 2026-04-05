import { useState, useRef, useEffect } from 'react'
import api from '../api.js'

// ─── Bank Statement Panel ────────────────────────────────────────────────────

function StatementRow({ row, idx, categories, onChange, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  function set(k, v) { onChange(idx, { ...row, [k]: v }) }

  return (
    <tr style={{ background: row._duplicate ? 'rgba(245,158,11,0.06)' : undefined }}>
      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
        <input className="input" type="date" value={row.date || ''} onChange={e => set('date', e.target.value)}
          style={{ padding: '4px 8px', fontSize: 13, width: 130 }} />
      </td>
      <td style={{ padding: '8px 10px' }}>
        <input className="input" value={row.vendor || ''} onChange={e => set('vendor', e.target.value)}
          style={{ padding: '4px 8px', fontSize: 13, minWidth: 120 }} />
      </td>
      <td style={{ padding: '8px 10px' }}>
        <select className="select" value={row.direction || 'debit'} onChange={e => set('direction', e.target.value)}
          style={{ padding: '4px 8px', fontSize: 13, width: 90 }}>
          <option value="debit">Debit</option>
          <option value="credit">Credit</option>
        </select>
      </td>
      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
        <input className="input" type="number" step="0.01" value={row.amount || ''} onChange={e => set('amount', parseFloat(e.target.value) || 0)}
          style={{ padding: '4px 8px', fontSize: 13, width: 100, textAlign: 'right' }} />
      </td>
      <td style={{ padding: '8px 10px' }}>
        <select className="select" value={row.category || 'Miscellaneous'} onChange={e => set('category', e.target.value)}
          style={{ padding: '4px 8px', fontSize: 13, minWidth: 130 }}>
          {row.category && !categories.includes(row.category) && <option value={row.category}>{row.category}</option>}
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
        {row._duplicate && <span className="badge badge-warning" style={{ fontSize: 11, marginRight: 6 }}>dup</span>}
        <button onClick={() => setExpanded(x => !x)} className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: '2px 6px', marginRight: 4 }}>
          {expanded ? '▲' : '▼'}
        </button>
        <button onClick={() => onDelete(idx)} className="btn btn-ghost btn-sm" style={{ fontSize: 14, padding: '2px 6px', color: 'var(--danger)' }}>×</button>
      </td>
      {expanded && (
        <td colSpan={6} style={{ padding: '0 10px 10px', background: 'var(--bg-secondary)' }}>
          <div className="form-row" style={{ marginTop: 8 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Notes</label>
              <input className="input" value={row.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Optional note" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Raw text</label>
              <input className="input" value={row.raw_text || ''} readOnly style={{ color: 'var(--text-secondary)', fontSize: 12 }} />
            </div>
          </div>
        </td>
      )}
    </tr>
  )
}

function StatementPanel({ stmtRef, stmtFile, setStmtFile, stmtRows, setStmtRows, stmtSaved, setStmtSaved, stmtLoading, setStmtLoading, categories, onSalaryDetected }) {
  const [parseError, setParseError] = useState(null)

  async function handleParse() {
    if (!stmtFile) return
    setStmtLoading(true)
    setParseError(null)
    setStmtRows([])
    setStmtSaved(null)
    try {
      const form = new FormData()
      form.append('file', stmtFile)
      const res = await api.post('/expenses/upload/statement/parse', form)
      setStmtRows(res.data.transactions)
    } catch (e) {
      setParseError(e.response?.data?.detail || 'Failed to parse statement')
    } finally {
      setStmtLoading(false)
    }
  }

  async function handleConfirm() {
    setStmtLoading(true)
    try {
      const toSave = stmtRows.filter(r => !r._duplicate)
      const res = await api.post('/expenses/upload/statement/confirm', { transactions: toSave })
      setStmtSaved(res.data)
      const hasSalary = toSave.some(r => r.direction === 'credit' && (r.category || '').toLowerCase() === 'salary')
      if (hasSalary) onSalaryDetected()
      setStmtRows([])
      setStmtFile(null)
    } catch (e) {
      setParseError(e.response?.data?.detail || 'Failed to save')
    } finally {
      setStmtLoading(false)
    }
  }

  function updateRow(idx, updated) { setStmtRows(r => r.map((x, i) => i === idx ? updated : x)) }
  function deleteRow(idx) { setStmtRows(r => r.filter((_, i) => i !== idx)) }
  const newRows = stmtRows.filter(r => !r._duplicate)
  const dupRows = stmtRows.filter(r => r._duplicate)

  return (
    <div>
      <input ref={stmtRef} type="file" accept="application/pdf" onChange={e => { setStmtFile(e.target.files[0] || null); setStmtRows([]); setStmtSaved(null); setParseError(null); e.target.value = '' }} style={{ display: 'none' }} />

      {stmtSaved && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          ✅ Saved {stmtSaved.saved} transactions
          {stmtSaved.skipped_duplicates > 0 && ` · skipped ${stmtSaved.skipped_duplicates} duplicates`}
          {stmtSaved.errors?.length > 0 && ` · ${stmtSaved.errors.length} errors`}
          <button onClick={() => setStmtSaved(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
      )}

      {parseError && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          {parseError}
          <button onClick={() => setParseError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
      )}

      {/* Upload zone */}
      {stmtRows.length === 0 && !stmtLoading && (
        <>
          <button
            onClick={() => stmtRef.current.click()}
            style={{
              width: '100%', padding: '36px 20px', border: '2px dashed var(--border)',
              borderRadius: 12, background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)', fontSize: 15, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10
            }}
          >
            <span style={{ fontSize: 40 }}>🏦</span>
            <span style={{ fontWeight: 600 }}>Upload Bank Statement PDF</span>
            <span style={{ fontSize: 13 }}>HDFC, ICICI, Axis, SBI — digital or scanned</span>
          </button>
          {stmtFile && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 24 }}>📄</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{stmtFile.name}</span>
              <button className="btn btn-primary" onClick={handleParse} disabled={stmtLoading}>
                Extract Transactions
              </button>
            </div>
          )}
        </>
      )}

      {stmtLoading && (
        <div className="loading-center">
          <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
          <p>Reading statement… this may take a moment for large files.</p>
        </div>
      )}

      {/* Review table */}
      {stmtRows.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 16 }}>Review {stmtRows.length} extracted transactions</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {newRows.length} new · {dupRows.length} already logged (shown in amber, will be skipped)
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setStmtRows([]); setStmtFile(null) }}>Start over</button>
              <button className="btn btn-primary" onClick={handleConfirm} disabled={stmtLoading || newRows.length === 0}>
                Save {newRows.length} Transactions
              </button>
            </div>
          </div>

          <div className="table-container" style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Amount (₹)</th>
                  <th>Category</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stmtRows.map((row, i) => (
                  <StatementRow key={i} row={row} idx={i} categories={categories} onChange={updateRow} onDelete={deleteRow} />
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn btn-primary btn-lg" onClick={handleConfirm} disabled={stmtLoading || newRows.length === 0}>
              {stmtLoading ? 'Saving…' : `Save ${newRows.length} Transactions`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────

const MODE_TABS = [
  { id: 'text',       label: '✏️ Paste SMS' },
  { id: 'bulk-text',  label: '📋 Bulk SMS' },
  { id: 'file',       label: '📎 Files / Photos' },
  { id: 'statement',  label: '🏦 Bank Statement' },
]

function EditForm({ txn, onSave, onCancel }) {
  const [form, setForm] = useState({
    amount:       txn.amount ?? '',
    direction:    txn.direction ?? 'debit',
    vendor:       txn.vendor ?? '',
    date:         txn.date ?? '',
    category:     txn.category ?? '',
    notes:        txn.notes ?? '',
    bank:         txn.bank ?? '',
    account_last4: txn.account_last4 ?? '',
    upi_ref:      txn.upi_ref ?? '',
  })
  const [categories, setCategories] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    api.get('/expenses/categories').then(r => setCategories(r.data.map(c => c.name))).catch(() => {})
  }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const res = await api.patch(`/expenses/transactions/${txn.id}`, {
        amount:       parseFloat(form.amount),
        direction:    form.direction,
        vendor:       form.vendor,
        date:         form.date,
        category:     form.category,
        notes:        form.notes || null,
        bank:         form.bank || null,
        account_last4: form.account_last4 || null,
        upi_ref:      form.upi_ref || null,
      })
      onSave(res.data)
    } catch (e) {
      setErr(e.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Edit Details
      </p>

      <div className="form-row" style={{ marginBottom: 10 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Amount (₹)</label>
          <input className="input" type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Direction</label>
          <select className="select" value={form.direction} onChange={e => set('direction', e.target.value)}>
            <option value="debit">Debit (expense)</option>
            <option value="credit">Credit (income)</option>
          </select>
        </div>
      </div>

      <div className="form-row" style={{ marginBottom: 10 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Vendor / Employer</label>
          <input className="input" value={form.vendor} onChange={e => set('vendor', e.target.value)} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Date</label>
          <input className="input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 10 }}>
        <label>Category</label>
        <select className="select" value={form.category} onChange={e => set('category', e.target.value)}>
          {form.category && !categories.includes(form.category) && (
            <option value={form.category}>{form.category}</option>
          )}
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="form-row" style={{ marginBottom: 10 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Bank</label>
          <input className="input" placeholder="e.g. HDFC Bank" value={form.bank} onChange={e => set('bank', e.target.value)} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Account last 4</label>
          <input className="input" placeholder="e.g. 1405" maxLength={4} value={form.account_last4} onChange={e => set('account_last4', e.target.value)} />
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 10 }}>
        <label>Notes</label>
        <input className="input" placeholder="Optional note" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      {err && <p className="error-text" style={{ marginBottom: 8 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving} style={{ flex: 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function ResultCard({ item, index, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [txn, setTxn] = useState(item.transaction)
  const ok = item.status === 'ok'

  function handleSave(updated) {
    setTxn(updated)
    setEditing(false)
    onUpdate && onUpdate(updated)
  }

  return (
    <div style={{
      borderRadius: 12, padding: 16, marginBottom: 10,
      background: ok ? 'var(--bg-card)' : 'rgba(239,68,68,0.06)',
      border: `1px solid ${ok ? 'var(--border)' : 'var(--danger)'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {index + 1}. {item.name}
          </p>
          {ok ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 18, fontWeight: 700,
                  color: txn?.direction === 'credit' ? 'var(--success)' : 'var(--danger)'
                }}>
                  {txn?.direction === 'credit' ? '+' : '-'}₹{Number(txn?.amount).toFixed(2)}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{txn?.vendor}</span>
                {item.duplicate && <span className="badge badge-neutral">duplicate</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="badge badge-info">{txn?.category}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{txn?.date}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{txn?.source_type?.replace(/_/g, ' ')}</span>
                {txn?.notes && <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>{txn.notes}</span>}
              </div>
              {item.budget_warning && item.budget_details?.map(b => (
                <p key={b.category} style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>
                  ⚠️ {b.category}: {b.percent}% of budget used
                </p>
              ))}
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 4 }}>{item.error}</p>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 18 }}>{ok ? '✅' : '❌'}</span>
          {ok && !editing && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setEditing(true)}
              style={{ fontSize: 12, padding: '3px 8px' }}
            >
              ✏️ Edit
            </button>
          )}
        </div>
      </div>

      {editing && txn && (
        <EditForm
          txn={txn}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  )
}

export default function Upload() {
  const [mode, setMode] = useState('text')
  const [text, setText] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const fileRef = useRef()

  const [showInvestPrompt, setShowInvestPrompt] = useState(false)

  // Bank statement state
  const stmtRef = useRef()
  const [stmtFile, setStmtFile] = useState(null)
  const [stmtRows, setStmtRows] = useState([])   // extracted, editable rows
  const [stmtSaved, setStmtSaved] = useState(null)
  const [stmtLoading, setStmtLoading] = useState(false)
  const [categories, setCategories] = useState([])

  useEffect(() => {
    api.get('/expenses/categories').then(r => setCategories(r.data.map(c => c.name))).catch(() => {})
  }, [])

  function handleFiles(e) {
    const selected = Array.from(e.target.files)
    setFiles(f => [...f, ...selected])
    setPreviews(p => [...p, ...selected.map(f => f.type.startsWith('image/') ? URL.createObjectURL(f) : null)])
    setResults([])
    setError(null)
    e.target.value = ''
  }

  function removeFile(idx) {
    setFiles(f => f.filter((_, i) => i !== idx))
    setPreviews(p => p.filter((_, i) => i !== idx))
  }

  async function handleSubmit() {
    setLoading(true)
    setResults([])
    setError(null)

    try {
      if (mode === 'text') {
        if (!text.trim()) { setError('Paste some text first.'); setLoading(false); return }
        const form = new FormData()
        form.append('text', text.trim())
        const res = await api.post('/expenses/upload', form)
        const newResults = [{ status: 'ok', name: text.slice(0, 60), ...res.data }]
        setResults(newResults)
        checkForSalary(newResults)
        setText('')

      } else if (mode === 'bulk-text') {
        const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
        if (!lines.length) { setError('Paste at least one line.'); setLoading(false); return }
        const form = new FormData()
        form.append('texts', bulkText)
        const res = await api.post('/expenses/upload/bulk', form)
        setResults(res.data.results)
        checkForSalary(res.data.results)
        setBulkText('')

      } else {
        if (!files.length) { setError('Pick at least one file.'); setLoading(false); return }
        const form = new FormData()
        files.forEach(f => form.append('files', f))
        const res = await api.post('/expenses/upload/bulk', form)
        setResults(res.data.results)
        checkForSalary(res.data.results)
        setFiles([])
        setPreviews([])
      }
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.error || 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  function checkForSalary(newResults) {
    const hasSalary = newResults.some(r =>
      r.status === 'ok' &&
      r.transaction?.direction === 'credit' &&
      (r.transaction?.category || '').toLowerCase() === 'salary'
    )
    if (hasSalary) setShowInvestPrompt(true)
  }

  const succeeded = results.filter(r => r.status === 'ok').length
  const failed = results.filter(r => r.status === 'error').length

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Log Expense</h1>
          <p className="page-subtitle">Paste SMS, upload receipts, invoices, or payslips</p>
        </div>
        {results.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={() => setResults([])}>Clear</button>
        )}
      </div>

      {showInvestPrompt && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 16px', borderRadius: 12, marginBottom: 16,
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>💰</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Salary received!</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Time to update your investment holdings?</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <a href="/investments" className="btn btn-primary btn-sm">Update Holdings →</a>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInvestPrompt(false)}>Dismiss</button>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {succeeded > 0 && <span className="badge badge-success" style={{ fontSize: 13, padding: '5px 12px' }}>✅ {succeeded} saved</span>}
          {failed > 0 && <span className="badge badge-danger" style={{ fontSize: 13, padding: '5px 12px' }}>❌ {failed} failed</span>}
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center' }}>Tap ✏️ Edit on any card to correct AI mistakes</span>
        </div>
      )}

      {results.map((item, i) => <ResultCard key={i} item={item} index={i} />)}

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
      )}

      {/* Mode tabs */}
      <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 10, padding: 4, marginBottom: 20, gap: 2 }}>
        {MODE_TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => { setMode(id); setError(null) }}
            style={{
              flex: 1, padding: '9px 4px', borderRadius: 8, border: 'none',
              background: mode === id ? 'var(--bg-card)' : 'transparent',
              color: mode === id ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: mode === id ? 600 : 400, fontSize: 12,
              boxShadow: mode === id ? 'var(--shadow-sm)' : 'none',
              cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'text' && (
        <div className="form-group">
          <label>UPI SMS, payslip summary, or transaction text</label>
          <textarea
            className="input" rows={6} value={text}
            onChange={e => setText(e.target.value)}
            placeholder="e.g. Sent Rs.500.00 From HDFC Bank A/C *1405 To Swiggy On 04-04-26"
            style={{ resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>
      )}

      {mode === 'bulk-text' && (
        <div className="form-group">
          <label>Paste multiple messages — one per line</label>
          <textarea
            className="input" rows={10} value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={"Sent Rs.138.00 From HDFC Bank A/C *1405 To Veeresh On 04-04-26\nSent Rs.500.00 From HDFC Bank A/C *1405 To Swiggy On 03-04-26"}
            style={{ resize: 'vertical', lineHeight: 1.6, fontFamily: 'monospace', fontSize: 13 }}
          />
          <p className="helper-text">{bulkText.split('\n').filter(l => l.trim()).length} messages</p>
        </div>
      )}

      {mode === 'file' && (
        <div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={handleFiles} style={{ display: 'none' }} />
          {files.length === 0 ? (
            <button
              onClick={() => fileRef.current.click()}
              style={{
                width: '100%', padding: '36px 20px', border: '2px dashed var(--border)',
                borderRadius: 12, background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)', fontSize: 15, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10
              }}
            >
              <span style={{ fontSize: 40 }}>📁</span>
              <span style={{ fontWeight: 600 }}>Tap to select files</span>
              <span style={{ fontSize: 13 }}>Invoices, receipts, payslips — JPG, PNG, PDF</span>
              <span style={{ fontSize: 12, color: 'var(--accent)' }}>Multiple files supported</span>
            </button>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{files.length} file{files.length !== 1 ? 's' : ''} selected</span>
                <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current.click()}>+ Add more</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
                {files.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border)'
                  }}>
                    {previews[i]
                      ? <img src={previews[i]} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                      : <span style={{ fontSize: 28, flexShrink: 0 }}>📄</span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</p>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {f.type.includes('pdf') ? 'PDF' : 'Image'} · {(f.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                    <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-secondary)', padding: 4 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Bank Statement ── */}
      {mode === 'statement' && <StatementPanel
        stmtRef={stmtRef}
        stmtFile={stmtFile} setStmtFile={setStmtFile}
        stmtRows={stmtRows} setStmtRows={setStmtRows}
        stmtSaved={stmtSaved} setStmtSaved={setStmtSaved}
        stmtLoading={stmtLoading} setStmtLoading={setStmtLoading}
        categories={categories}
        onSalaryDetected={() => setShowInvestPrompt(true)}
      />}

      {mode !== 'statement' && (
        <>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 20, padding: '14px', fontSize: 16, borderRadius: 12 }}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> Processing…
              </span>
            ) : mode === 'file' && files.length > 1
              ? `Extract & Save ${files.length} Files`
              : mode === 'bulk-text'
              ? `Process ${bulkText.split('\n').filter(l => l.trim()).length || 0} Messages`
              : 'Extract & Save'
            }
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 12 }}>
            Payslips auto-detected as income · Tap ✏️ Edit to fix any AI mistakes
          </p>
        </>
      )}
    </div>
  )
}
