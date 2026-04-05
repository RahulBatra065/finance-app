import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import api from '../api.js'

const CARD_COLORS = ['#3B82F6', '#F59E0B', '#8B5CF6', '#EF4444', '#22C55E']
const CAT_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#64748B', '#06B6D4']

function fmt(n) {
  const abs = Math.abs(n ?? 0)
  if (abs >= 100000) return `₹${((n ?? 0) / 100000).toFixed(1)}L`
  if (abs >= 1000) return `₹${((n ?? 0) / 1000).toFixed(1)}K`
  return `₹${Number(n ?? 0).toFixed(0)}`
}

const Tooltip_ = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
      <p style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ fontSize: 13, color: p.color ?? 'var(--text-primary)', margin: '2px 0' }}>
          {p.name}: ₹{Number(p.value).toLocaleString('en-IN')}
        </p>
      ))}
    </div>
  )
}

function CardPanel({ card, color }) {
  const [expanded, setExpanded] = useState(false)
  const outstandingColor = card.outstanding > 0 ? 'var(--danger)' : 'var(--success)'

  return (
    <div className="card" style={{ marginBottom: 20, borderTop: `3px solid ${color}` }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
            💳
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{card.display_name}</div>
            {card.accounts.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {card.accounts.map(a => `••••${a}`).join('  ·  ')}
              </div>
            )}
          </div>
        </div>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? 'Less ▲' : 'Details ▼'}
        </button>
      </div>

      {/* ── Summary stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'This Period', value: card.period_spend, color: 'var(--text-primary)' },
          { label: 'Total Charges', value: card.total_charges, color: 'var(--danger)' },
          { label: 'Payments Made', value: card.total_payments, color: 'var(--success)' },
          { label: 'Outstanding', value: card.outstanding, color: outstandingColor },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center', padding: '10px 6px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{fmt(s.value)}</div>
          </div>
        ))}
      </div>

      {/* ── Monthly spend trend ── */}
      {card.monthly_spend.length > 0 && (
        <div style={{ marginBottom: expanded ? 20 : 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>Monthly Spend</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={card.monthly_spend} margin={{ top: 2, right: 10, left: -10, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} tickFormatter={v => fmt(v)} width={56} />
              <Tooltip content={<Tooltip_ />} />
              <Bar dataKey="spend" name="Spend" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Expanded: category breakdown + recent txns ── */}
      {expanded && (
        <>
          {/* Category breakdown */}
          {card.category_breakdown.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>Spend by Category</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                {/* Pie chart */}
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={card.category_breakdown}
                      dataKey="amount"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={85}
                      paddingAngle={2}
                    >
                      {card.category_breakdown.map((_, idx) => (
                        <Cell key={idx} fill={CAT_COLORS[idx % CAT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={v => `₹${Number(v).toLocaleString('en-IN')}`} />
                    <Legend formatter={v => <span style={{ fontSize: 11 }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>

                {/* Category list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                  {card.category_breakdown.slice(0, 8).map((c, idx) => (
                    <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: CAT_COLORS[idx % CAT_COLORS.length], flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.category}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>{fmt(c.amount)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, width: 36, textAlign: 'right' }}>{c.percent}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Recent transactions */}
          {card.recent_transactions.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>Recent Transactions</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {card.recent_transactions.map((t, i) => {
                  const isCredit = t.direction === 'credit'
                  const fmtDate = new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                  return (
                    <div
                      key={t.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 0',
                        borderBottom: i < card.recent_transactions.length - 1 ? '1px solid var(--border)' : 'none',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                          background: isCredit ? 'rgba(34,197,94,0.1)' : `${color}18`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                        }}>
                          {isCredit ? '↓' : '↑'}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.vendor || 'Unknown'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                            {t.category} · {fmtDate}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, flexShrink: 0, color: isCredit ? 'var(--success)' : 'var(--danger)' }}>
                        {isCredit ? '+' : '-'}₹{Number(t.amount).toLocaleString('en-IN')}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function CreditCards() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/expenses/credit-cards')
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load credit card data.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="loading-center"><div className="spinner" /><span>Loading cards...</span></div>
  )
  if (error) return <div className="alert alert-danger">{error}</div>

  const cards = data?.cards ?? []

  if (!cards.length) return (
    <div className="empty-state" style={{ marginTop: 60 }}>
      <div className="empty-state-icon">💳</div>
      <h3>No credit card transactions yet</h3>
      <p>Upload bank statements or SMS messages that include credit card transactions.</p>
    </div>
  )

  // Total outstanding across all cards
  const totalOutstanding = cards.reduce((s, c) => s + (c.outstanding ?? 0), 0)
  const totalPeriodSpend = cards.reduce((s, c) => s + (c.period_spend ?? 0), 0)

  return (
    <div>
      {/* Top summary bar */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label">Cards</div>
          <div className="stat-value">{cards.length}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Active credit cards</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">This Period Spend</div>
          <div className="stat-value negative">{fmt(totalPeriodSpend)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Across all cards</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Outstanding</div>
          <div className="stat-value" style={{ color: totalOutstanding > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {fmt(totalOutstanding)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Unpaid balance</div>
        </div>
      </div>

      {/* Per-card panels */}
      {cards.map((card, i) => (
        <CardPanel key={card.name} card={card} color={CARD_COLORS[i % CARD_COLORS.length]} />
      ))}
    </div>
  )
}
