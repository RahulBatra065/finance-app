import { useState, useEffect, useRef, useCallback } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import api from '../api.js'

const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#64748B', '#06B6D4']

function fmt(n, decimals = 2) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtCurrency(n) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (abs >= 100000) return `₹${(n / 100000).toFixed(2)}L`
  return `₹${fmt(n)}`
}

function PLCell({ value, pct }) {
  const color = value >= 0 ? 'var(--success)' : 'var(--danger)'
  return (
    <div style={{ color }}>
      <div style={{ fontWeight: 600 }}>{value >= 0 ? '+' : ''}{fmtCurrency(value)}</div>
      {pct != null && (
        <div style={{ fontSize: 11 }}>{value >= 0 ? '+' : ''}{fmt(pct, 2)}%</div>
      )}
    </div>
  )
}

// ─── MF Search Dropdown ───────────────────────────────────────────────────────
function MFSearchInput({ value, onChange, onSelect }) {
  const [query, setQuery] = useState(value || '')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleInputChange(e) {
    const q = e.target.value
    setQuery(q)
    onChange(q)
    clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.get(`/investments/search-mf?q=${encodeURIComponent(q)}`)
        setResults(res.data?.results ?? res.data ?? [])
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 350)
  }

  function handleSelect(fund) {
    setQuery(fund.scheme_name ?? fund.name)
    setOpen(false)
    onSelect(fund)
  }

  return (
    <div style={{ position: 'relative' }} ref={containerRef}>
      <input
        className="input"
        placeholder="Search mutual fund name..."
        value={query}
        onChange={handleInputChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        autoComplete="off"
      />
      {loading && (
        <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
          <span className="spinner" style={{ width: 14, height: 14 }} />
        </div>
      )}
      {open && results.length > 0 && (
        <div className="dropdown-list">
          {results.map((f, i) => (
            <div
              key={f.scheme_code ?? f.id ?? i}
              className="dropdown-item"
              onClick={() => handleSelect(f)}
            >
              <div style={{ fontWeight: 500, fontSize: 13 }}>{f.scheme_name ?? f.name}</div>
              {f.fund_house && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{f.fund_house}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Add/Edit Holding Modal ───────────────────────────────────────────────────
function HoldingModal({ onClose, onSave, editing }) {
  const [type, setType] = useState(editing?.type ?? 'Mutual Fund')
  const [name, setName] = useState(editing?.name ?? '')
  const [ticker, setTicker] = useState(editing?.ticker ?? editing?.symbol ?? '')
  const [units, setUnits] = useState(editing?.units_or_shares ?? '')
  const [avgPrice, setAvgPrice] = useState(editing?.average_buy_price ?? '')
  const [buyDate, setBuyDate] = useState(editing?.buy_date ? editing.buy_date.split('T')[0] : '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [mfSchemeCode, setMfSchemeCode] = useState(editing?.scheme_code ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function handleMFSelect(fund) {
    setName(fund.scheme_name ?? fund.name)
    setMfSchemeCode(fund.scheme_code ?? '')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('Name is required.')
    if (!units || isNaN(units) || Number(units) <= 0) return setError('Enter valid units.')
    if (!avgPrice || isNaN(avgPrice) || Number(avgPrice) <= 0) return setError('Enter a valid average buy price.')

    setSubmitting(true)
    try {
      const payload = {
        type,
        name: name.trim(),
        units_or_shares: parseFloat(units),
        average_buy_price: parseFloat(avgPrice),
        buy_date: buyDate || null,
        notes: notes.trim() || null,
        ...(type === 'Mutual Fund' ? { scheme_code: mfSchemeCode || null } : { ticker: ticker.trim().toUpperCase() || null }),
      }
      if (editing?.id) {
        await api.put(`/investments/holdings/${editing.id}`, payload)
      } else {
        await api.post('/investments/holdings', payload)
      }
      onSave()
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to save holding.'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>{editing ? 'Edit Holding' : 'Add Holding'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '4px 8px' }}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="form-group">
              <label>Type</label>
              <select className="select" value={type} onChange={e => setType(e.target.value)}>
                <option value="Mutual Fund">Mutual Fund</option>
                <option value="Stock">Stock</option>
              </select>
            </div>

            <div className="form-group">
              <label>{type === 'Mutual Fund' ? 'Search Fund' : 'Stock Name'}</label>
              {type === 'Mutual Fund' ? (
                <MFSearchInput value={name} onChange={setName} onSelect={handleMFSelect} />
              ) : (
                <input
                  className="input"
                  placeholder="e.g. Reliance Industries"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              )}
            </div>

            {type === 'Stock' && (
              <div className="form-group">
                <label>NSE Ticker Symbol</label>
                <input
                  className="input"
                  placeholder="e.g. RELIANCE, INFY, TCS"
                  value={ticker}
                  onChange={e => setTicker(e.target.value.toUpperCase())}
                  style={{ fontFamily: 'monospace', textTransform: 'uppercase' }}
                />
                <p className="helper-text">Enter the NSE symbol (e.g. RELIANCE, HDFCBANK)</p>
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>Units / Quantity</label>
                <input
                  type="number"
                  className="input"
                  placeholder="e.g. 100.5"
                  value={units}
                  onChange={e => setUnits(e.target.value)}
                  step="0.001"
                  min="0"
                />
              </div>
              <div className="form-group">
                <label>Avg Buy Price (₹)</label>
                <input
                  type="number"
                  className="input"
                  placeholder="e.g. 150.00"
                  value={avgPrice}
                  onChange={e => setAvgPrice(e.target.value)}
                  step="0.01"
                  min="0"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Buy Date</label>
                <input
                  type="date"
                  className="input"
                  value={buyDate}
                  onChange={e => setBuyDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className="form-group" />
            </div>

            <div className="form-group">
              <label>Notes (optional)</label>
              <input
                className="input"
                placeholder="Any notes about this investment"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (
                <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> Saving...</>
              ) : (editing ? 'Save Changes' : 'Add Holding')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Redeem Modal ─────────────────────────────────────────────────────────────
function RedeemModal({ holding, onClose, onSave }) {
  const [units, setUnits] = useState('')
  const [sellPrice, setSellPrice] = useState(holding.current_price ?? '')
  const [redeemDate, setRedeemDate] = useState(new Date().toISOString().split('T')[0])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const redeemUnits = parseFloat(units) || 0
  const remaining = holding.units_or_shares - redeemUnits
  const proceeds = redeemUnits * (parseFloat(sellPrice) || 0)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!redeemUnits || redeemUnits <= 0) return setError('Enter units to redeem.')
    if (redeemUnits > holding.units_or_shares) return setError(`Cannot redeem more than ${holding.units_or_shares} units.`)
    if (!sellPrice || parseFloat(sellPrice) <= 0) return setError('Enter a valid sell price.')

    setSubmitting(true)
    try {
      if (remaining <= 0.0001) {
        await api.delete(`/investments/holdings/${holding.id}`)
      } else {
        await api.put(`/investments/holdings/${holding.id}`, {
          units_or_shares: parseFloat(remaining.toFixed(6)),
        })
      }
      onSave()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to redeem.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Redeem Holding</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '4px 8px' }}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

            <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{holding.name}</div>
              <div style={{ color: 'var(--text-secondary)' }}>Available: {fmt(holding.units_or_shares, 3)} units · Avg buy: ₹{fmt(holding.average_buy_price)}</div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Units to Redeem</label>
                <input
                  type="number" className="input"
                  placeholder={`Max ${holding.units_or_shares}`}
                  value={units} onChange={e => setUnits(e.target.value)}
                  step="0.001" min="0" max={holding.units_or_shares}
                />
              </div>
              <div className="form-group">
                <label>Sell Price (₹)</label>
                <input
                  type="number" className="input"
                  value={sellPrice} onChange={e => setSellPrice(e.target.value)}
                  step="0.01" min="0"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Redemption Date</label>
              <input type="date" className="input" value={redeemDate} onChange={e => setRedeemDate(e.target.value)} max={new Date().toISOString().split('T')[0]} />
            </div>

            {redeemUnits > 0 && (
              <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Proceeds</span>
                  <span style={{ fontWeight: 600 }}>₹{fmt(proceeds)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Units remaining</span>
                  <span style={{ fontWeight: 600 }}>{remaining <= 0.0001 ? 'Fully redeemed' : fmt(remaining, 3)}</span>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}>
              {submitting ? (
                <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> Redeeming...</>
              ) : 'Confirm Redemption'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Investments Page ────────────────────────────────────────────────────
export default function Investments() {
  const [holdings, setHoldings] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [redeeming, setRedeeming] = useState(null)
  const [error, setError] = useState('')
  const [lastRefreshed, setLastRefreshed] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/investments/holdings')
      const data = res.data
      setHoldings(data.holdings ?? data ?? [])
      setSummary(data.summary ?? null)
      if (data.last_refreshed) setLastRefreshed(data.last_refreshed)
    } catch {
      setError('Failed to load investments.')
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchData().finally(() => setLoading(false))
  }, [fetchData])

  async function handleRefreshPrices() {
    setRefreshing(true)
    setError('')
    try {
      await api.post('/investments/refresh-prices')
      await fetchData()
      setLastRefreshed(new Date().toISOString())
    } catch {
      setError('Failed to refresh prices.')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this holding?')) return
    try {
      await api.delete(`/investments/holdings/${id}`)
      setHoldings(h => h.filter(x => x.id !== id))
    } catch {
      setError('Failed to delete holding.')
    }
  }

  function handleEdit(holding) {
    setEditing(holding)
    setShowModal(true)
  }

  function handleAdd() {
    setEditing(null)
    setShowModal(true)
  }

  async function handleSaved() {
    setShowModal(false)
    setEditing(null)
    await fetchData()
  }

  // Compute summary from holdings (API returns pre-computed fields from _compute_holding)
  const totalInvested = holdings.reduce((s, h) => s + (h.invested_value ?? 0), 0)
  const currentValue  = holdings.reduce((s, h) => s + (h.current_value  ?? 0), 0)
  const pl    = currentValue - totalInvested
  const plPct = totalInvested > 0 ? (pl / totalInvested) * 100 : 0

  // Allocation chart data
  const pieData = holdings.map(h => ({
    name: h.name,
    value: h.current_value ?? 0,
  })).filter(d => d.value > 0)

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
        <p style={{ fontWeight: 600, fontSize: 13 }}>{payload[0].name}</p>
        <p style={{ fontSize: 13, color: 'var(--accent)' }}>{fmtCurrency(payload[0].value)}</p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{((payload[0].value / currentValue) * 100).toFixed(1)}%</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span>Loading investments...</span>
      </div>
    )
  }

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}

      {/* Page header */}
      <div className="page-header">
        <div>
          <div className="page-title">Investments</div>
          {lastRefreshed && (
            <div className="page-subtitle">
              Last refreshed: {new Date(lastRefreshed).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleRefreshPrices}
            disabled={refreshing}
          >
            {refreshing ? (
              <><span className="spinner" style={{ width: 14, height: 14 }} /> Refreshing...</>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                Refresh Prices
              </>
            )}
          </button>
          <button className="btn btn-primary" onClick={handleAdd}>
            + Add Holding
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label">Total Invested</div>
          <div className="stat-value">{fmtCurrency(totalInvested)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Current Value</div>
          <div className="stat-value">{fmtCurrency(currentValue)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">P&L</div>
          <div className={`stat-value ${pl >= 0 ? 'positive' : 'negative'}`}>
            {pl >= 0 ? '+' : ''}{fmtCurrency(pl)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">P&L %</div>
          <div className={`stat-value ${plPct >= 0 ? 'positive' : 'negative'}`}>
            {plPct >= 0 ? '+' : ''}{fmt(plPct, 2)}%
          </div>
        </div>
      </div>

      {holdings.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📈</div>
            <h3>No holdings yet</h3>
            <p>Add your first investment holding to get started.</p>
            <button className="btn btn-primary" onClick={handleAdd} style={{ marginTop: 16 }}>
              + Add Holding
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Allocation chart */}
          {pieData.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-title">Portfolio Allocation</div>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    dataKey="value"
                    nameKey="name"
                    paddingAngle={2}
                  >
                    {pieData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    formatter={(value) => (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {value.length > 22 ? value.slice(0, 22) + '…' : value}
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Holdings table */}
          <div className="card">
            <div className="section-title">Holdings</div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>Units</th>
                    <th style={{ textAlign: 'right' }}>Avg Buy (₹)</th>
                    <th style={{ textAlign: 'right' }}>CMP (₹)</th>
                    <th style={{ textAlign: 'right' }}>Current Value</th>
                    <th style={{ textAlign: 'right' }}>P&L</th>
                    <th style={{ textAlign: 'right' }}>Days Held</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map(h => (
                      <tr key={h.id}>
                        <td>
                          <div style={{ fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {h.name}
                          </div>
                          {h.ticker && (
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                              {h.ticker}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${h.type === 'Mutual Fund' ? 'badge-info' : 'badge-neutral'}`}>
                            {h.type}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>{fmt(h.units_or_shares, 3)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(h.average_buy_price)}</td>
                        <td style={{ textAlign: 'right' }}>{h.current_price != null ? fmt(h.current_price) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtCurrency(h.current_value)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <PLCell value={h.pnl} pct={h.pnl_pct} />
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--text-secondary)', fontSize: 13 }}>
                          {h.days_held != null ? `${h.days_held}d` : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleEdit(h)}
                              style={{ color: 'var(--accent)' }}
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setRedeeming(h)}
                              style={{ color: 'var(--warning, #F59E0B)' }}
                              title="Redeem"
                            >
                              💸
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleDelete(h.id)}
                              style={{ color: 'var(--danger)' }}
                              title="Delete"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showModal && (
        <HoldingModal
          editing={editing}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSave={handleSaved}
        />
      )}

      {redeeming && (
        <RedeemModal
          holding={redeeming}
          onClose={() => setRedeeming(null)}
          onSave={async () => { setRedeeming(null); await fetchData() }}
        />
      )}
    </div>
  )
}
